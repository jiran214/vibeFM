import { lstat, mkdir, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

export const WORKSPACE_DIRECTORY = ".vibefm";
export const WORKSPACE_INFO_FILE = "info.json";

export type WorkspaceErrorCode =
  | "INVALID_WORKSPACE_NAME"
  | "INVALID_PROMPT"
  | "WORKSPACE_ALREADY_EXISTS"
  | "WORKSPACE_NOT_FOUND"
  | "INVALID_WORKSPACE_ENTRY";

export class WorkspaceError extends Error {
  constructor(
    public readonly code: WorkspaceErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkspaceError";
  }
}

export interface Workspace {
  name: string;
  path: string;
}

export interface WorkspaceInfo {
  path: string;
  prompt: string;
}

export interface CreatedWorkspace extends Workspace {
  info: WorkspaceInfo;
}

export function validateWorkspaceName(name: string): string {
  if (name.length === 0 || name !== name.trim()) {
    throw new WorkspaceError(
      "INVALID_WORKSPACE_NAME",
      "Workspace name must not be empty or have surrounding whitespace.",
    );
  }

  if (
    name === "." ||
    name === ".." ||
    name.includes("/") ||
    name.includes("\\") ||
    /[\u0000-\u001f\u007f]/u.test(name)
  ) {
    throw new WorkspaceError(
      "INVALID_WORKSPACE_NAME",
      "Workspace name must be a single safe directory name.",
    );
  }

  return name;
}

export function getWorkspaceRoot(baseDirectory = process.cwd()): string {
  return path.resolve(baseDirectory, WORKSPACE_DIRECTORY);
}

export function getWorkspacePath(
  name: string,
  baseDirectory = process.cwd(),
): string {
  const safeName = validateWorkspaceName(name);
  const root = getWorkspaceRoot(baseDirectory);
  const workspacePath = path.resolve(root, safeName);

  if (path.dirname(workspacePath) !== root) {
    throw new WorkspaceError(
      "INVALID_WORKSPACE_NAME",
      "Workspace path must be directly inside the workspace root.",
    );
  }

  return workspacePath;
}

export async function createWorkspace(
  name: string,
  prompt: string,
  baseDirectory = process.cwd(),
): Promise<CreatedWorkspace> {
  if (prompt.trim().length === 0) {
    throw new WorkspaceError(
      "INVALID_PROMPT",
      "Workspace prompt must not be empty.",
    );
  }

  const workspacePath = getWorkspacePath(name, baseDirectory);
  await mkdir(getWorkspaceRoot(baseDirectory), { recursive: true });

  try {
    await mkdir(workspacePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "EEXIST") {
      throw new WorkspaceError(
        "WORKSPACE_ALREADY_EXISTS",
        `Workspace "${name}" already exists.`,
      );
    }
    throw error;
  }

  const infoPath = path.join(workspacePath, WORKSPACE_INFO_FILE);
  try {
    await writeJsonAtomically(infoPath, { prompt });
  } catch (error) {
    await rm(workspacePath, { recursive: true, force: true });
    throw error;
  }

  return {
    name,
    path: workspacePath,
    info: { path: infoPath, prompt },
  };
}

export async function getWorkspace(
  name: string,
  baseDirectory = process.cwd(),
): Promise<Workspace> {
  const workspacePath = getWorkspacePath(name, baseDirectory);

  let entry;
  try {
    entry = await lstat(workspacePath);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new WorkspaceError(
        "WORKSPACE_NOT_FOUND",
        `Workspace "${name}" does not exist.`,
      );
    }
    throw error;
  }

  if (!entry.isDirectory() || entry.isSymbolicLink()) {
    throw new WorkspaceError(
      "INVALID_WORKSPACE_ENTRY",
      `Workspace "${name}" is not a workspace directory.`,
    );
  }

  return { name, path: workspacePath };
}

export async function deleteWorkspace(
  name: string,
  baseDirectory = process.cwd(),
): Promise<Workspace> {
  const workspace = await getWorkspace(name, baseDirectory);
  await rm(workspace.path, { recursive: true });
  return workspace;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
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
