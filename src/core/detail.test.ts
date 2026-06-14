import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  generateDetail,
  DetailError,
  type GenerateDetailOptions,
} from "./detail.js";
import { createWorkspace } from "./workspaces.js";

async function setupWorkspace(trackIds: number[] = [101, 102]) {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-detail-"));
  const workspace = await createWorkspace("test", "test prompt", baseDirectory);
  const infoPath = path.join(workspace.path, "info.json");
  const existing = JSON.parse(await readFile(infoPath, "utf8"));
  await writeFile(
    infoPath,
    JSON.stringify({ ...existing, think: "plan", track_ids: trackIds }),
  );
  return { baseDirectory, workspace, infoPath };
}

function createMockFetch(responses: Record<string, unknown>) {
  return async (input: string | URL | Request, _init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const body = responses[url] ?? responses["default"] ?? {};
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

function createMockFetchSequence(responses: unknown[][]) {
  let callIndex = 0;
  return async (_input: string | URL | Request, _init?: RequestInit) => {
    const body = responses[callIndex] ?? {};
    callIndex++;
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };
}

test("generateDetail fetches lyrics and comments for each track", async () => {
  const { baseDirectory, infoPath } = await setupWorkspace([101, 102]);

  const lyricResponses: Record<string, unknown>[] = [
    { lrc: { lyric: "[00:12.34] hello\n[00:15.67] world" } },
    { lrc: { lyric: "[01:00.00] foo\n[01:05.00] bar\n[01:10.00] baz" } },
  ];
  const commentResponses: Record<string, unknown>[] = [
    { comments: [{ content: "great song" }, { content: "love it" }] },
    { comments: [{ content: "amazing" }] },
  ];

  let fetchCallIndex = 0;
  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    let body: unknown;
    if (url.includes("/weapi/song/lyric")) {
      body = lyricResponses[fetchCallIndex] ?? {};
    } else if (url.includes("/weapi/v1/resource/comments/")) {
      body = commentResponses[fetchCallIndex] ?? {};
      fetchCallIndex++;
    } else {
      body = {};
    }
    return new Response(JSON.stringify(body), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  const result = await generateDetail("test", baseDirectory, {
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc123",
  });

  assert.equal(result.trackCount, 2);
  assert.equal(result.lyricsCount, 2);
  assert.equal(result.commentsCount, 3);

  const info = JSON.parse(await readFile(infoPath, "utf8"));
  assert.equal(info.tracks_lyrics.length, 2);
  assert.equal(info.tracks_lyrics[0].id, 101);
  assert.equal(info.tracks_lyrics[0].lyrics, "[00:12]hello\n[00:15]world");
  assert.equal(info.tracks_lyrics[1].lyrics, "[01:00]foo\n[01:05]bar\n[01:10]baz");
  assert.equal(info.tracks_comments.length, 2);
  assert.equal(info.tracks_comments[0].comments.length, 2);
  assert.equal(info.tracks_comments[0].comments[0], "great song");
  assert.equal(info.tracks_comments[1].comments.length, 1);
});

test("generateDetail uses default comment limit of 10", async () => {
  const { baseDirectory } = await setupWorkspace([50]);
  let capturedBody: string | undefined;

  const mockFetch = async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.includes("/weapi/v1/resource/comments/")) {
      capturedBody = typeof init?.body === "string" ? init.body : undefined;
    }
    return new Response(JSON.stringify({ comments: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });
  };

  await generateDetail("test", baseDirectory, {
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc",
  });

  assert.ok(capturedBody, "should have called comments endpoint");
  const params = new URLSearchParams(capturedBody);
  const encrypted = params.get("params");
  assert.ok(encrypted, "should have encrypted params");
});

test("generateDetail respects custom comment limit", async () => {
  const { baseDirectory } = await setupWorkspace([50]);

  const mockFetch = async () =>
    new Response(JSON.stringify({ comments: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await generateDetail("test", baseDirectory, {
    limit: 5,
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc",
  });

  assert.equal(result.trackCount, 1);
});

test("generateDetail handles empty lyrics gracefully", async () => {
  const { baseDirectory, infoPath } = await setupWorkspace([200]);

  const mockFetch = async () =>
    new Response(JSON.stringify({ lrc: null, comments: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  const result = await generateDetail("test", baseDirectory, {
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc",
  });

  assert.equal(result.lyricsCount, 0);
  assert.equal(result.commentsCount, 0);

  const info = JSON.parse(await readFile(infoPath, "utf8"));
  assert.equal(info.tracks_lyrics[0].lyrics, "未知");
  assert.equal(info.tracks_comments[0].comments.length, 0);
});

test("generateDetail handles HTTP errors gracefully", async () => {
  const { baseDirectory, infoPath } = await setupWorkspace([300]);

  const mockFetch = async () =>
    new Response("{}", { status: 500 });

  const result = await generateDetail("test", baseDirectory, {
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc",
  });

  assert.equal(result.lyricsCount, 0);
  assert.equal(result.commentsCount, 0);

  const info = JSON.parse(await readFile(infoPath, "utf8"));
  assert.equal(info.tracks_lyrics[0].lyrics, "未知");
  assert.equal(info.tracks_comments[0].comments.length, 0);
});

test("generateDetail rejects missing info.json", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-detail-"));
  const workspace = await createWorkspace("empty", "prompt", baseDirectory);
  const { rm } = await import("node:fs/promises");
  await rm(path.join(workspace.path, "info.json"));

  await assert.rejects(
    generateDetail("empty", baseDirectory, {
      fetch: async () => new Response("{}"),
      cookie: "test=value",
    }),
    (error: unknown) =>
      error instanceof DetailError &&
      error.code === "MISSING_DETAIL_DEPENDENCY",
  );
});

test("generateDetail rejects missing track_ids", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-detail-"));
  await createWorkspace("notracks", "prompt", baseDirectory);

  await assert.rejects(
    generateDetail("notracks", baseDirectory, {
      fetch: async () => new Response("{}"),
      cookie: "test=value",
    }),
    (error: unknown) =>
      error instanceof DetailError &&
      error.code === "INVALID_DETAIL_DEPENDENCY",
  );
});

test("generateDetail rejects empty track_ids array", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-detail-"));
  const workspace = await createWorkspace("emptyids", "prompt", baseDirectory);
  const infoPath = path.join(workspace.path, "info.json");
  await writeFile(infoPath, JSON.stringify({ prompt: "p", track_ids: [] }));

  await assert.rejects(
    generateDetail("emptyids", baseDirectory, {
      fetch: async () => new Response("{}"),
      cookie: "test=value",
    }),
    (error: unknown) =>
      error instanceof DetailError &&
      error.code === "INVALID_DETAIL_DEPENDENCY",
  );
});

test("generateDetail preserves existing info.json fields", async () => {
  const { baseDirectory, infoPath } = await setupWorkspace([400]);

  const mockFetch = async () =>
    new Response(JSON.stringify({ lrc: { lyric: "" }, comments: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await generateDetail("test", baseDirectory, {
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc",
  });

  const info = JSON.parse(await readFile(infoPath, "utf8"));
  assert.equal(info.prompt, "test prompt");
  assert.equal(info.think, "plan");
  assert.deepEqual(info.track_ids, [400]);
  assert.ok(Array.isArray(info.tracks_lyrics));
  assert.ok(Array.isArray(info.tracks_comments));
});

test("generateDetail parses LRC timestamps correctly", async () => {
  const { baseDirectory, infoPath } = await setupWorkspace([500]);

  const lrc = [
    "[00:00.00] intro",
    "[00:05.50] verse 1",
    "[01:23.45] chorus",
    "[02:00.00]",
    "not a lyric line",
    "[03:10.123] outro",
  ].join("\n");

  const mockFetch = async () =>
    new Response(JSON.stringify({ lrc: { lyric: lrc }, comments: [] }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await generateDetail("test", baseDirectory, {
    fetch: mockFetch as unknown as typeof fetch,
    cookie: "test=value; __csrf=abc",
  });

  const info = JSON.parse(await readFile(infoPath, "utf8"));
  const lyrics = info.tracks_lyrics[0].lyrics;
  assert.equal(lyrics, "[00:00]intro\n[00:05]verse 1\n[01:23]chorus\n[02:00]\n[03:10]outro");
});
