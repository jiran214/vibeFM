import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  computeProgress,
  createWorkspace,
  deleteWorkspace,
  getWorkspaceShowDetail,
  getWorkspacePath,
  listWorkspaces,
  WorkspaceError,
} from "./workspaces.js";

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vibefm-"));
}

test("createWorkspace creates a program directory and info.json", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace(
    "night-radio",
    "适合深夜独处、情绪逐渐平静的电台",
    baseDirectory,
  );

  assert.equal(
    workspace.path,
    path.join(baseDirectory, ".vibefm", "night-radio"),
  );
  assert.deepEqual(
    JSON.parse(await readFile(path.join(workspace.path, "info.json"), "utf8")),
    { prompt: "适合深夜独处、情绪逐渐平静的电台" },
  );
});

test("createWorkspace allows an empty prompt", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("night-radio", "", baseDirectory);

  assert.equal(workspace.name, "night-radio");
  assert.deepEqual(
    JSON.parse(await readFile(path.join(workspace.path, "info.json"), "utf8")),
    { prompt: "" },
  );
});

test("createWorkspace rejects duplicate names", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("night-radio", "Late night radio", baseDirectory);

  await assert.rejects(
    createWorkspace("night-radio", "Another prompt", baseDirectory),
    (error: unknown) =>
      error instanceof WorkspaceError &&
      error.code === "WORKSPACE_ALREADY_EXISTS",
  );
});

test("workspace names cannot escape the workspace root", () => {
  assert.throws(
    () => getWorkspacePath("../outside", "/tmp/project"),
    (error: unknown) =>
      error instanceof WorkspaceError &&
      error.code === "INVALID_WORKSPACE_NAME",
  );
});

test("deleteWorkspace removes a workspace recursively", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace(
    "night-radio",
    "Late night radio",
    baseDirectory,
  );
  const artifact = path.join(workspace.path, "playlist.json");
  await writeFile(artifact, "{}", "utf8");

  await deleteWorkspace("night-radio", baseDirectory);

  await assert.rejects(readFile(artifact, "utf8"), { code: "ENOENT" });
});

test("deleteWorkspace reports a missing workspace", async () => {
  const baseDirectory = await createTempDirectory();

  await assert.rejects(
    deleteWorkspace("missing", baseDirectory),
    (error: unknown) =>
      error instanceof WorkspaceError && error.code === "WORKSPACE_NOT_FOUND",
  );
});

test("listWorkspaces returns empty array when no workspaces exist", async () => {
  const baseDirectory = await createTempDirectory();
  const items = await listWorkspaces(baseDirectory);
  assert.deepEqual(items, []);
});

test("listWorkspaces returns all workspaces with metadata", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("show-a", "Prompt A", baseDirectory);
  await createWorkspace("show-b", "Prompt B", baseDirectory);

  const items = await listWorkspaces(baseDirectory);
  assert.equal(items.length, 2);
  const names = items.map((i) => i.name).sort();
  assert.deepEqual(names, ["show-a", "show-b"]);
  assert.equal(items.find((i) => i.name === "show-a")?.prompt, "Prompt A");
});

test("listWorkspaces includes title from info.json and playlist metadata", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("with-playlist", "Test", baseDirectory);

  const infoData = { prompt: "Test", title: "My Show Title" };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "with-playlist", "info.json"),
    JSON.stringify(infoData),
  );

  const playlistData = {
    playlist: {
      name: "My Playlist",
      imageUrl: "https://example.com/cover.jpg",
      tracks: [],
    },
  };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "with-playlist", "playlist.json"),
    JSON.stringify(playlistData),
  );

  const items = await listWorkspaces(baseDirectory);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "My Show Title");
  assert.equal(items[0].playlist_name, "My Playlist");
  assert.equal(items[0].playlistImageUrl, "https://example.com/cover.jpg");
});

test("listWorkspaces defaults title to 生成中... when info.json has no title", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("no-title", "Test", baseDirectory);

  const items = await listWorkspaces(baseDirectory);
  assert.equal(items.length, 1);
  assert.equal(items[0].title, "生成中...");
});

test("getWorkspaceShowDetail returns empty tracks when no plan exists", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("no-plan", "Test", baseDirectory);

  const infoData = { prompt: "Test", title: "My Show Title" };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "no-plan", "info.json"),
    JSON.stringify(infoData),
  );

  const playlistData = {
    playlist: {
      name: "Test Playlist",
      imageUrl: "https://example.com/img.jpg",
      tracks: [
        { id: 1, name: "Song A", artists: [{ name: "Artist A" }] },
      ],
    },
  };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "no-plan", "playlist.json"),
    JSON.stringify(playlistData),
  );

  const detail = await getWorkspaceShowDetail("no-plan", baseDirectory);
  assert.equal(detail.name, "no-plan");
  assert.equal(detail.title, "My Show Title");
  assert.equal(detail.playlist_name, "Test Playlist");
  assert.equal(detail.playlistImageUrl, "https://example.com/img.jpg");
  assert.deepEqual(detail.tracks, []);
});

test("getWorkspaceShowDetail returns selected tracks from plan", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("with-plan", "Test", baseDirectory);

  const playlistData = {
    playlist: {
      name: "Selected Songs",
      imageUrl: "https://example.com/pic.jpg",
      tracks: [
        { id: 1, name: "Song A", artists: [{ name: "Artist 1" }] },
        { id: 2, name: "Song B", artists: [{ name: "Artist 2" }, { name: "Artist 3" }] },
        { id: 3, name: "Song C", artists: [{ name: "Artist 4" }] },
      ],
    },
  };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "with-plan", "playlist.json"),
    JSON.stringify(playlistData),
  );

  const infoData = { prompt: "Test", track_ids: [1, 3] };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "with-plan", "info.json"),
    JSON.stringify(infoData),
  );

  const detail = await getWorkspaceShowDetail("with-plan", baseDirectory);
  assert.equal(detail.tracks.length, 2);
  assert.deepEqual(detail.tracks[0], { id: 1, name: "Song A", artists: ["Artist 1"] });
  assert.deepEqual(detail.tracks[1], { id: 3, name: "Song C", artists: ["Artist 4"] });
});

test("getWorkspaceShowDetail reports missing workspace", async () => {
  const baseDirectory = await createTempDirectory();

  await assert.rejects(
    getWorkspaceShowDetail("missing", baseDirectory),
    (error: unknown) =>
      error instanceof WorkspaceError && error.code === "WORKSPACE_NOT_FOUND",
  );
});

test("computeProgress returns 0 for empty workspace", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("empty", "Test", baseDirectory);

  const progress = await computeProgress(workspace.path);
  assert.equal(progress, 0);
});

test("computeProgress returns 100 when all stages complete", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("full", "Test", baseDirectory);
  const wp = workspace.path;

  await writeFile(path.join(wp, "playlist.json"), "{}");
  await writeFile(
    path.join(wp, "info.json"),
    JSON.stringify({
      prompt: "test",
      think: "reason",
      track_ids: [1],
      tracks_lyrics: [{ id: 1, lyrics: [] }],
      tracks_comments: [{ id: 1, comments: [] }],
    }),
  );
  await writeFile(path.join(wp, "script.md"), "# Script");
  await writeFile(path.join(wp, "events.json"), "[]");

  const { mkdir } = await import("node:fs/promises");
  await mkdir(path.join(wp, "audio"), { recursive: true });
  await writeFile(path.join(wp, "audio", "manifest.json"), "{}");
  await mkdir(path.join(wp, "speech"), { recursive: true });
  await writeFile(path.join(wp, "speech", "manifest.json"), "{}");
  await mkdir(path.join(wp, "output"), { recursive: true });
  await writeFile(path.join(wp, "output", "program.mp3"), "");
  await writeFile(path.join(wp, "output", "program.srt"), "");
  await writeFile(path.join(wp, "output", "manifest.json"), "{}");

  const progress = await computeProgress(wp);
  assert.equal(progress, 100);
});

test("computeProgress returns correct partial percentage", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("partial", "Test", baseDirectory);
  const wp = workspace.path;

  await writeFile(path.join(wp, "playlist.json"), "{}");
  await writeFile(
    path.join(wp, "info.json"),
    JSON.stringify({ prompt: "test", track_ids: [1] }),
  );

  const progress = await computeProgress(wp);
  assert.equal(progress, 25);
});

test("listWorkspaces includes progress", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("prog-test", "Test", baseDirectory);

  const items = await listWorkspaces(baseDirectory);
  assert.equal(items.length, 1);
  assert.equal(items[0].progress, 0);
});

test("getWorkspaceShowDetail includes progress and playlist_name", async () => {
  const baseDirectory = await createTempDirectory();
  await createWorkspace("detail-prog", "Test", baseDirectory);

  const playlistData = {
    playlist: { name: "My Playlist", imageUrl: "https://example.com/img.jpg", tracks: [] },
  };
  await writeFile(
    path.join(baseDirectory, ".vibefm", "detail-prog", "playlist.json"),
    JSON.stringify(playlistData),
  );

  const detail = await getWorkspaceShowDetail("detail-prog", baseDirectory);
  assert.equal(detail.progress, 13);
  assert.equal(detail.playlist_name, "My Playlist");
});
