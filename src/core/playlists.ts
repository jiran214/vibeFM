import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { readCookie } from "./cookie.js";
import {
  getWorkspace,
  updateWorkspacePrompt,
  WORKSPACE_INFO_FILE,
  type Workspace,
} from "./workspaces.js";

const NETEASE_PLAYLIST_API_URL =
  "https://music.163.com/api/v6/playlist/detail";
const NETEASE_SONG_API_URL = "https://music.163.com/api/song/detail";
const NETEASE_SEARCH_API_URL = "https://music.163.com/api/search/get";
const REQUEST_TIMEOUT_MS = 15_000;
const SONG_DETAIL_BATCH_SIZE = 100;

export type PlaylistImportErrorCode =
  | "INVALID_PLAYLIST_URL"
  | "PLAYLIST_REQUEST_FAILED"
  | "INVALID_PLAYLIST_RESPONSE"
  | "NO_SEARCH_RESULTS"
  | "SEARCH_REQUEST_FAILED";

export class PlaylistImportError extends Error {
  constructor(
    public readonly code: PlaylistImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "PlaylistImportError";
  }
}

export interface PlaylistImportResult {
  workspace: Workspace;
  path: string;
  playlistId: string;
  playlistName: string;
  trackCount: number;
}

export interface PlaylistImportOptions {
  fetch?: typeof fetch;
  now?: () => Date;
  cookie?: string;
}

interface JsonObject {
  [key: string]: unknown;
}

export interface NeteaseSearchResult {
  playlistId: string;
  playlistName: string;
  trackCount: number;
}

export async function searchNeteasePlaylist(
  query: string,
  baseDirectory: string,
  options: PlaylistImportOptions = {},
): Promise<NeteaseSearchResult> {
  const fetchImpl = options.fetch ?? fetch;
  const cookie = options.cookie ?? (await readCookie(baseDirectory));

  let response: Response;
  try {
    response = await fetchImpl(NETEASE_SEARCH_API_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/x-www-form-urlencoded",
        Cookie: cookie,
        Referer: "https://music.163.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vibeFM/0.1",
      },
      body: `s=${encodeURIComponent(query)}&type=1000&limit=1&offset=0`,
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new PlaylistImportError(
      "SEARCH_REQUEST_FAILED",
      `Failed to search NetEase playlists: ${getErrorMessage(error)}`,
    );
  }

  if (!response.ok) {
    throw new PlaylistImportError(
      "SEARCH_REQUEST_FAILED",
      `NetEase search request failed with HTTP ${response.status}.`,
    );
  }

  let payload: unknown;
  try {
    payload = await response.json();
  } catch {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      "NetEase returned an invalid JSON response.",
    );
  }

  const result = asObject(payload);
  const playlists = asArray(result?.playlists ?? result?.result?.playlists);

  if (!playlists || playlists.length === 0) {
    throw new PlaylistImportError(
      "NO_SEARCH_RESULTS",
      `No playlists found for query: "${query}"`,
    );
  }

  const playlist = asObject(playlists[0]);
  const playlistId = asId(playlist?.id);
  const playlistName = asString(playlist?.name);
  const trackCount = asNumber(playlist?.trackCount);

  if (playlistId === undefined || playlistName === undefined) {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      "NetEase search returned an invalid playlist entry.",
    );
  }

  return {
    playlistId,
    playlistName,
    trackCount: trackCount ?? 0,
  };
}

export async function importNeteasePlaylist(
  workspaceName: string,
  playlistUrl: string,
  baseDirectory = process.cwd(),
  options: PlaylistImportOptions = {},
): Promise<PlaylistImportResult> {
  const playlistId = parseNeteasePlaylistId(playlistUrl);
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const fetchImpl = options.fetch ?? fetch;
  const apiUrl = `${NETEASE_PLAYLIST_API_URL}?id=${encodeURIComponent(playlistId)}`;
  const payload = await requestJson(fetchImpl, apiUrl, playlistId);
  const tracks = await loadCompleteTracks(payload, fetchImpl, playlistId);

  const artifact = normalizePlaylistResponse(
    payload,
    tracks,
    playlistUrl,
    playlistId,
    (options.now ?? (() => new Date()))(),
  );
  const artifactPath = path.join(workspace.path, "playlist.json");
  await writeJsonAtomically(artifactPath, artifact);

  const infoPath = path.join(workspace.path, WORKSPACE_INFO_FILE);
  try {
    const info = JSON.parse(await readFile(infoPath, "utf8"));
    if (!info.prompt && artifact.playlist.name) {
      await updateWorkspacePrompt(
        workspaceName,
        `歌单《${artifact.playlist.name}》精选电台`,
        baseDirectory,
      );
    }
  } catch {
    // info.json missing or unreadable — skip auto-fill
  }

  return {
    workspace,
    path: artifactPath,
    playlistId,
    playlistName: artifact.playlist.name,
    trackCount: artifact.playlist.tracks.length,
  };
}

export function parseNeteasePlaylistId(playlistUrl: string): string {
  let url: URL;
  try {
    url = new URL(playlistUrl);
  } catch {
    throw invalidPlaylistUrl();
  }

  const hostname = url.hostname.toLowerCase();
  if (
    (url.protocol !== "https:" && url.protocol !== "http:") ||
    (hostname !== "music.163.com" && !hostname.endsWith(".music.163.com"))
  ) {
    throw invalidPlaylistUrl();
  }

  const routeUrl = getPlaylistRouteUrl(url);
  const isPlaylistRoute = routeUrl.pathname
    .toLowerCase()
    .includes("/playlist");
  const pathId = routeUrl.pathname.match(/\/playlist\/(\d+)(?:\/|$)/u)?.[1];
  const playlistId = routeUrl.searchParams.get("id") ?? pathId;

  if (!isPlaylistRoute || playlistId == null || !/^\d+$/u.test(playlistId)) {
    throw invalidPlaylistUrl();
  }

  return playlistId;
}

function getPlaylistRouteUrl(url: URL): URL {
  if (!url.hash.startsWith("#/")) {
    return url;
  }

  try {
    return new URL(url.hash.slice(1), url.origin);
  } catch {
    throw invalidPlaylistUrl();
  }
}

function normalizePlaylistResponse(
  payload: unknown,
  tracks: unknown[],
  sourceUrl: string,
  playlistId: string,
  importedAt: Date,
) {
  const playlist = getPlaylistData(payload);
  const name = asString(playlist?.name);
  const responseId = asId(playlist?.id) ?? playlistId;

  if (name === undefined) {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      "NetEase playlist response is missing playlist details or tracks.",
    );
  }

  return {
    version: 1,
    importedAt: importedAt.toISOString(),
    source: {
      provider: "netease",
      url: sourceUrl,
      playlistId,
    },
    playlist: compactObject({
      id: toJsonId(responseId),
      name,
      description: asString(playlist.description),
      imageUrl: asString(playlist.coverImgUrl),
      creator: normalizeCreator(playlist.creator),
      trackCount: tracks.length,
      playCount: asNumber(playlist.playCount),
      tracks: tracks.map(normalizeTrack),
    }),
  };
}

async function loadCompleteTracks(
  payload: unknown,
  fetchImpl: typeof fetch,
  playlistId: string,
): Promise<unknown[]> {
  const playlist = getPlaylistData(payload);
  const tracks = asArray(playlist.tracks) ?? [];
  const rawTrackIds = asArray(playlist.trackIds);

  if (rawTrackIds === undefined || rawTrackIds.length === 0) {
    return tracks;
  }

  const trackIds = rawTrackIds.map((item, index) => {
    const id = asId(asObject(item)?.id);
    if (id === undefined) {
      throw new PlaylistImportError(
        "INVALID_PLAYLIST_RESPONSE",
        `NetEase playlist response contains an invalid track id at index ${index}.`,
      );
    }
    return id;
  });
  const tracksById = new Map<string, unknown>();

  for (const track of tracks) {
    const id = asId(asObject(track)?.id);
    if (id !== undefined) {
      tracksById.set(id, track);
    }
  }

  const missingIds = [
    ...new Set(trackIds.filter((id) => !tracksById.has(id))),
  ];

  for (let offset = 0; offset < missingIds.length; offset += SONG_DETAIL_BATCH_SIZE) {
    const batch = missingIds.slice(offset, offset + SONG_DETAIL_BATCH_SIZE);
    const ids = batch.map((id) => toJsonId(id));
    const url = `${NETEASE_SONG_API_URL}?ids=${encodeURIComponent(JSON.stringify(ids))}`;
    const songPayload = await requestJson(fetchImpl, url, playlistId);
    const root = asObject(songPayload);
    const code = asNumber(root?.code);
    const songs = asArray(root?.songs);

    if (code !== 200) {
      throw new PlaylistImportError(
        "PLAYLIST_REQUEST_FAILED",
        `NetEase song detail request returned API code ${code ?? "unknown"}.`,
      );
    }
    if (songs === undefined) {
      throw new PlaylistImportError(
        "INVALID_PLAYLIST_RESPONSE",
        "NetEase song detail response is missing songs.",
      );
    }

    for (const song of songs) {
      const id = asId(asObject(song)?.id);
      if (id !== undefined) {
        tracksById.set(id, song);
      }
    }
  }

  const completedTracks = trackIds.map((id) => tracksById.get(id));
  if (completedTracks.some((track) => track === undefined)) {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      "NetEase did not return details for every playlist track.",
    );
  }

  return completedTracks;
}

function getPlaylistData(payload: unknown): JsonObject {
  const root = asObject(payload);
  const apiCode = asNumber(root?.code);
  const playlist = asObject(root?.result) ?? asObject(root?.playlist);
  const tracks = asArray(playlist?.tracks);

  if (apiCode !== 200) {
    throw new PlaylistImportError(
      "PLAYLIST_REQUEST_FAILED",
      `NetEase playlist request returned API code ${apiCode ?? "unknown"}.`,
    );
  }
  if (playlist === undefined || tracks === undefined) {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      "NetEase playlist response is missing playlist details or tracks.",
    );
  }

  return playlist;
}

async function requestJson(
  fetchImpl: typeof fetch,
  url: string,
  playlistId: string,
): Promise<unknown> {
  let response: Response;
  try {
    response = await fetchImpl(url, {
      headers: {
        accept: "application/json",
        referer: `https://music.163.com/playlist?id=${playlistId}`,
        "user-agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vibeFM/0.1",
      },
      signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
    });
  } catch (error) {
    throw new PlaylistImportError(
      "PLAYLIST_REQUEST_FAILED",
      `Failed to request NetEase playlist ${playlistId}: ${getErrorMessage(error)}`,
    );
  }

  if (!response.ok) {
    throw new PlaylistImportError(
      "PLAYLIST_REQUEST_FAILED",
      `NetEase request failed with HTTP ${response.status}.`,
    );
  }

  try {
    return await response.json();
  } catch {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      "NetEase returned an invalid JSON response.",
    );
  }
}

function normalizeCreator(value: unknown) {
  const creator = asObject(value);
  const id = asId(creator?.userId ?? creator?.id);
  const name = asString(creator?.nickname ?? creator?.name);

  if (creator === undefined || (id === undefined && name === undefined)) {
    return undefined;
  }

  return compactObject({ id: toJsonId(id), name });
}

function normalizeTrack(value: unknown, index: number) {
  const track = asObject(value);
  const id = asId(track?.id);
  const name = asString(track?.name);
  const artists = asArray(track?.artists ?? track?.ar);
  const album = asObject(track?.album ?? track?.al);

  if (track === undefined || id === undefined || name === undefined) {
    throw new PlaylistImportError(
      "INVALID_PLAYLIST_RESPONSE",
      `NetEase playlist response contains an invalid track at index ${index}.`,
    );
  }

  return compactObject({
    id: toJsonId(id),
    name,
    aliases: asStringArray(track.alias ?? track.alia),
    durationMs: asNumber(track.duration ?? track.dt),
    fee: asNumber(track.fee),
    artists: artists?.map(normalizeArtist) ?? [],
    album: normalizeAlbum(album),
  });
}

function normalizeArtist(value: unknown) {
  const artist = asObject(value);
  return compactObject({
    id: toJsonId(asId(artist?.id)),
    name: asString(artist?.name) ?? "Unknown artist",
  });
}

function normalizeAlbum(album: JsonObject | undefined) {
  if (album === undefined) {
    return undefined;
  }

  const publishTime = asNumber(album.publishTime);
  return compactObject({
    id: toJsonId(asId(album.id)),
    name: asString(album.name) ?? "Unknown album",
    imageUrl: asString(album.picUrl),
    publishedAt:
      publishTime === undefined ? undefined : new Date(publishTime).toISOString(),
  });
}

async function writeJsonAtomically(filePath: string, value: unknown) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asStringArray(value: unknown): string[] | undefined {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function asId(value: unknown): string | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return String(value);
  }
  return undefined;
}

function toJsonId(value: string | undefined): number | string | undefined {
  if (value === undefined) {
    return undefined;
  }
  const numericId = Number(value);
  return Number.isSafeInteger(numericId) ? numericId : value;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, item]) => item !== undefined),
  ) as T;
}

function invalidPlaylistUrl(): PlaylistImportError {
  return new PlaylistImportError(
    "INVALID_PLAYLIST_URL",
    "Playlist URL must be a NetEase Cloud Music playlist URL containing a numeric id.",
  );
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown network error";
}
