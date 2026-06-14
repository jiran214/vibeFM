import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { weapiEncrypt } from "./audio.js";
import { readCookie } from "./cookie.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

const INFO_FILE = "info.json";

export type DetailErrorCode =
  | "MISSING_DETAIL_DEPENDENCY"
  | "INVALID_DETAIL_DEPENDENCY"
  | "DETAIL_REQUEST_FAILED";

export class DetailError extends Error {
  constructor(
    public readonly code: DetailErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "DetailError";
  }
}

export interface DetailResult {
  workspace: Workspace;
  trackCount: number;
  lyricsCount: number;
  commentsCount: number;
}

export interface GenerateDetailOptions {
  limit?: number;
  fetch?: typeof fetch;
  cookie?: string;
  baseDirectory?: string;
}

interface LyricLine {
  time: string;
  text: string;
}

interface TrackLyrics {
  id: number;
  lyrics: string;
}

interface TrackComments {
  id: number;
  comments: string[];
}

const DEFAULT_COMMENT_LIMIT = 10;
const REQUEST_TIMEOUT_MS = 15_000;

function formatLyrics(lyrics: LyricLine[]): string {
  if (lyrics.length === 0) return "未知";
  return lyrics
    .map((l) => {
      const [min, sec] = l.time.split(":");
      return `[${min}:${sec.split(".")[0]}]${l.text || ""}`;
    })
    .join("  ");
}

export async function generateDetail(
  workspaceName: string,
  baseDirectory = process.cwd(),
  options: GenerateDetailOptions = {},
): Promise<DetailResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const infoPath = path.join(workspace.path, INFO_FILE);

  let info: Record<string, unknown>;
  try {
    const content = await readFile(infoPath, "utf8");
    info = JSON.parse(content);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new DetailError(
        "MISSING_DETAIL_DEPENDENCY",
        "Required detail dependency info.json does not exist.",
      );
    }
    throw error;
  }

  const rawTrackIds = Array.isArray(info.track_ids) ? info.track_ids : undefined;
  if (rawTrackIds === undefined || rawTrackIds.length === 0) {
    throw new DetailError(
      "INVALID_DETAIL_DEPENDENCY",
      "info.json must contain a non-empty track_ids array.",
    );
  }

  const trackIds = rawTrackIds as number[];
  const limit = options.limit ?? DEFAULT_COMMENT_LIMIT;
  const fetchImpl = options.fetch ?? fetch;
  const cookie = options.cookie ?? await readCookie(baseDirectory);
  const csrfToken = cookie.match(/__csrf=([^;]+)/u)?.[1] ?? "";

  const tracksLyrics: TrackLyrics[] = [];
  const tracksComments: TrackComments[] = [];

  for (const trackId of trackIds) {
    const [lyrics, comments] = await Promise.all([
      fetchLyrics(trackId, csrfToken, cookie, fetchImpl),
      fetchComments(trackId, limit, csrfToken, cookie, fetchImpl),
    ]);
    tracksLyrics.push({ id: trackId, lyrics: formatLyrics(lyrics) });
    tracksComments.push({ id: trackId, comments });
  }

  const updatedInfo = {
    ...info,
    tracks_lyrics: tracksLyrics,
    tracks_comments: tracksComments,
  };
  await writeJsonAtomically(infoPath, updatedInfo);

  return {
    workspace,
    trackCount: trackIds.length,
    lyricsCount: tracksLyrics.filter((t) => t.lyrics !== "未知").length,
    commentsCount: tracksComments.reduce((sum, t) => sum + t.comments.length, 0),
  };
}

async function fetchLyrics(
  trackId: number,
  csrfToken: string,
  cookie: string,
  fetchImpl: typeof fetch,
): Promise<LyricLine[]> {
  const url = `https://music.163.com/weapi/song/lyric?csrf_token=${csrfToken}`;
  const data = JSON.stringify({
    id: trackId,
    lv: 0,
    tv: 0,
    csrf_token: csrfToken,
  });
  const encrypted = weapiEncrypt(data);

  const body = new URLSearchParams({
    params: encrypted.params,
    encSecKey: encrypted.encSecKey,
  }).toString();

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: "https://music.163.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vibeFM/0.1",
    Cookie: cookie,
  };

  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return [];
  }

  const json = await response.json() as Record<string, unknown>;
  const lrc = json.lrc as Record<string, unknown> | undefined;
  const lyricStr = typeof lrc?.lyric === "string" ? lrc.lyric : "";

  return parseLrc(lyricStr);
}

function parseLrc(text: string): LyricLine[] {
  const lines: LyricLine[] = [];
  for (const line of text.split("\n")) {
    const match = line.match(/^\[(\d{2}:\d{2}\.\d{2,3})\]\s*(.*)$/u);
    if (match) {
      lines.push({ time: match[1], text: match[2].trim() });
    }
  }
  return lines;
}

async function fetchComments(
  trackId: number,
  limit: number,
  csrfToken: string,
  cookie: string,
  fetchImpl: typeof fetch,
): Promise<string[]> {
  const rid = `R_SO_4_${trackId}`;
  const url = `https://music.163.com/weapi/v1/resource/comments/${rid}?csrf_token=${csrfToken}`;
  const data = JSON.stringify({
    rid,
    offset: 0,
    total: true,
    limit,
    csrf_token: csrfToken,
  });
  const encrypted = weapiEncrypt(data);

  const body = new URLSearchParams({
    params: encrypted.params,
    encSecKey: encrypted.encSecKey,
  }).toString();

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: "https://music.163.com/",
    "User-Agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vibeFM/0.1",
    Cookie: cookie,
  };

  const response = await fetchImpl(url, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
  });

  if (!response.ok) {
    return [];
  }
  const json = await response.json() as Record<string, unknown>;
  // 优先取hotComments其次comments
  const rawComments = Array.isArray(json.hotComments)    ? json.hotComments
    : Array.isArray(json.comments)
      ? json.comments
      : [];
  return rawComments
    .map((c) => (c as Record<string, unknown>).content)
    .filter((c): c is string => typeof c === "string" && c.trim().length > 0);
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
