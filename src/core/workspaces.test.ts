import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  createWorkspace,
  deleteWorkspace,
  getWorkspacePath,
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

test("createWorkspace rejects an empty prompt", async () => {
  const baseDirectory = await createTempDirectory();

  await assert.rejects(
    createWorkspace("night-radio", "   ", baseDirectory),
    (error: unknown) =>
      error instanceof WorkspaceError && error.code === "INVALID_PROMPT",
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
