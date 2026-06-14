import assert from "node:assert/strict";
import { mkdtemp, readFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkspace } from "./workspaces.js";
import {
  importNeteasePlaylist,
  searchNeteasePlaylist,
  PlaylistImportError,
} from "./playlists.js";

const playlistResponse = {
  code: 200,
  result: {
    id: 6792103822,
    name: "Midnight Radio",
    description: "Songs for late nights",
    coverImgUrl: "https://example.com/cover.jpg",
    trackCount: 1,
    playCount: 42,
    creator: {
      userId: 123,
      nickname: "DJ Test",
    },
    tracks: [
      {
        id: 5257138,
        name: "Roof",
        duration: 288000,
        fee: 8,
        alias: ["Rooftop"],
        artists: [
          { id: 6452, name: "Jay" },
          { id: 6453, name: "Landy" },
        ],
        album: {
          id: 512175,
          name: "Duets",
          picUrl: "https://example.com/album.jpg",
          publishTime: 1170604800000,
        },
      },
    ],
  },
};

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vibefm-playlist-"));
}

test("importNeteasePlaylist writes normalized playlist data", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace(
    "night-radio",
    "Late night radio",
    baseDirectory,
  );
  const requestedUrls: string[] = [];

  const result = await importNeteasePlaylist(
    "night-radio",
    "https://music.163.com/playlist?id=6792103822&userid=123",
    baseDirectory,
    {
      fetch: async (input) => {
        requestedUrls.push(String(input));
        return new Response(JSON.stringify(playlistResponse), {
          status: 200,
          headers: { "content-type": "application/json" },
        });
      },
      now: () => new Date("2026-06-13T10:00:00.000Z"),
    },
  );

  assert.deepEqual(requestedUrls, [
    "https://music.163.com/api/v6/playlist/detail?id=6792103822",
  ]);
  assert.equal(result.trackCount, 1);
  assert.equal(result.path, path.join(workspace.path, "playlist.json"));

  const artifact = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(artifact.version, 1);
  assert.equal(artifact.importedAt, "2026-06-13T10:00:00.000Z");
  assert.deepEqual(artifact.source, {
    provider: "netease",
    url: "https://music.163.com/playlist?id=6792103822&userid=123",
    playlistId: "6792103822",
  });
  assert.equal(artifact.playlist.name, "Midnight Radio");
  assert.deepEqual(artifact.playlist.creator, {
    id: 123,
    name: "DJ Test",
  });
  assert.deepEqual(artifact.playlist.tracks[0], {
    id: 5257138,
    name: "Roof",
    aliases: ["Rooftop"],
    durationMs: 288000,
    fee: 8,
    artists: [
      { id: 6452, name: "Jay" },
      { id: 6453, name: "Landy" },
    ],
    album: {
      id: 512175,
      name: "Duets",
      imageUrl: "https://example.com/album.jpg",
      publishedAt: "2007-02-04T16:00:00.000Z",
    },
  });
});

test("importNeteasePlaylist loads tracks omitted from playlist details", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("night-radio", "Late night radio", baseDirectory);
  const responseWithTrackIds = structuredClone(playlistResponse);
  Object.assign(responseWithTrackIds.result, {
    trackCount: 2,
    trackIds: [{ id: 5257138 }, { id: 5257139 }],
  });
  const requestedUrls: string[] = [];

  const result = await importNeteasePlaylist(
    "night-radio",
    "https://music.163.com/playlist?id=6792103822",
    baseDirectory,
    {
      fetch: async (input) => {
        const url = String(input);
        requestedUrls.push(url);
        if (url.includes("/api/v6/playlist/detail")) {
          return Response.json(responseWithTrackIds);
        }
        return Response.json({
          code: 200,
          songs: [
            {
              id: 5257139,
              name: "Second song",
              duration: 180000,
              artists: [{ id: 100, name: "Second artist" }],
              album: { id: 200, name: "Second album" },
            },
          ],
        });
      },
    },
  );

  assert.equal(result.trackCount, 2);
  assert.deepEqual(requestedUrls, [
    "https://music.163.com/api/v6/playlist/detail?id=6792103822",
    "https://music.163.com/api/song/detail?ids=%5B5257139%5D",
  ]);
  const artifact = JSON.parse(await readFile(result.path, "utf8"));
  assert.deepEqual(
    artifact.playlist.tracks.map((track: { id: number }) => track.id),
    [5257138, 5257139],
  );
});

test("importNeteasePlaylist accepts a playlist id in a hash URL", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("night-radio", "Late night radio", baseDirectory);

  const result = await importNeteasePlaylist(
    "night-radio",
    "https://music.163.com/#/playlist?id=6792103822",
    baseDirectory,
    {
      fetch: async () => Response.json(playlistResponse),
    },
  );

  assert.equal(result.playlistId, "6792103822");
});

test("importNeteasePlaylist rejects non-NetEase URLs", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("night-radio", "Late night radio", baseDirectory);

  await assert.rejects(
    importNeteasePlaylist(
      "night-radio",
      "https://example.com/playlist?id=6792103822",
      baseDirectory,
    ),
    (error: unknown) =>
      error instanceof PlaylistImportError &&
      error.code === "INVALID_PLAYLIST_URL",
  );
});

test("importNeteasePlaylist rejects malformed API responses", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("night-radio", "Late night radio", baseDirectory);

  await assert.rejects(
    importNeteasePlaylist(
      "night-radio",
      "https://music.163.com/playlist?id=6792103822",
      baseDirectory,
      { fetch: async () => Response.json({ code: 200, result: {} }) },
    ),
    (error: unknown) =>
      error instanceof PlaylistImportError &&
      error.code === "INVALID_PLAYLIST_RESPONSE",
  );
});

test("searchNeteasePlaylist returns first matching playlist", async () => {
  const baseDirectory = await createTempDirectory();
  const searchResponse = {
    code: 200,
    result: {
      playlists: [
        {
          id: 123456789,
          name: "Test Playlist",
          trackCount: 10,
          creator: { nickname: "Test User" },
        },
      ],
    },
  };

  const result = await searchNeteasePlaylist("test query", baseDirectory, {
    fetch: async () => Response.json(searchResponse),
    cookie: "test_cookie",
  });

  assert.equal(result.playlistId, "123456789");
  assert.equal(result.playlistName, "Test Playlist");
  assert.equal(result.trackCount, 10);
});

test("searchNeteasePlaylist throws NO_SEARCH_RESULTS when no playlists found", async () => {
  const baseDirectory = await createTempDirectory();
  const searchResponse = {
    code: 200,
    result: {
      playlists: [],
    },
  };

  await assert.rejects(
    searchNeteasePlaylist("nonexistent", baseDirectory, {
      fetch: async () => Response.json(searchResponse),
      cookie: "test_cookie",
    }),
    (error: unknown) =>
      error instanceof PlaylistImportError &&
      error.code === "NO_SEARCH_RESULTS",
  );
});

test("searchNeteasePlaylist throws SEARCH_REQUEST_FAILED on network error", async () => {
  const baseDirectory = await createTempDirectory();

  await assert.rejects(
    searchNeteasePlaylist("test", baseDirectory, {
      fetch: async () => {
        throw new Error("Network error");
      },
      cookie: "test_cookie",
    }),
    (error: unknown) =>
      error instanceof PlaylistImportError &&
      error.code === "SEARCH_REQUEST_FAILED",
  );
});
