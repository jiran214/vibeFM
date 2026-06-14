import { lstat, mkdir, readFile, readdir, rename, rm, writeFile } from "node:fs/promises";
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

export async function updateWorkspacePrompt(
  name: string,
  prompt: string,
  baseDirectory = process.cwd(),
): Promise<void> {
  const workspacePath = getWorkspacePath(name, baseDirectory);
  const infoPath = path.join(workspacePath, WORKSPACE_INFO_FILE);
  await writeJsonAtomically(infoPath, { prompt });
}

export async function readWorkspaceInfo(
  name: string,
  baseDirectory = process.cwd(),
): Promise<WorkspaceInfo> {
  const workspacePath = getWorkspacePath(name, baseDirectory);
  const infoPath = path.join(workspacePath, WORKSPACE_INFO_FILE);
  const raw = JSON.parse(await readFile(infoPath, "utf8"));
  return { path: infoPath, prompt: raw.prompt ?? "" };
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

export interface WorkspaceStageStatus {
  stage: string;
  status: "completed" | "pending";
}

export interface WorkspaceStatusResult {
  workspace: Workspace;
  stages: WorkspaceStageStatus[];
}

const STATUS_STAGES: { stage: string; files: string[] }[] = [
  { stage: "playlist", files: ["playlist.json"] },
  { stage: "plan", files: ["info.json"] },
  { stage: "detail", files: ["info.json"] },
  { stage: "script", files: ["script.md"] },
  { stage: "events", files: ["events.json"] },
  { stage: "audio", files: ["audio/manifest.json"] },
  { stage: "speech", files: ["speech/manifest.json"] },
  {
    stage: "render",
    files: [
      "output/program.mp3",
      "output/program.srt",
      "output/manifest.json",
    ],
  },
];

async function computeStageStatuses(
  workspacePath: string,
): Promise<WorkspaceStageStatus[]> {
  const stages: WorkspaceStageStatus[] = [];

  for (const { stage, files } of STATUS_STAGES) {
    const filePaths = files.map((file) => path.join(workspacePath, file));
    const filePath = filePaths[0];
    let status: "completed" | "pending" = "pending";
    try {
      await Promise.all(filePaths.map((candidate) => lstat(candidate)));
      if (stage === "plan") {
        const content = await readFile(filePath, "utf8");
        const info = JSON.parse(content);
        status =
          Array.isArray(info.track_ids) && info.track_ids.length > 0
            ? "completed"
            : "pending";
      } else if (stage === "detail") {
        const content = await readFile(filePath, "utf8");
        const info = JSON.parse(content);
        status =
          Array.isArray(info.tracks_lyrics) && info.tracks_lyrics.length > 0
            ? "completed"
            : "pending";
      } else {
        status = "completed";
      }
    } catch {
      // file does not exist or invalid JSON
    }
    stages.push({ stage, status });
  }

  return stages;
}

export async function computeProgress(
  workspacePath: string,
): Promise<number> {
  const stages = await computeStageStatuses(workspacePath);
  const completed = stages.filter((s) => s.status === "completed").length;
  return Math.round((completed / stages.length) * 100);
}

export async function getWorkspaceStatus(
  name: string,
  baseDirectory = process.cwd(),
): Promise<WorkspaceStatusResult> {
  const workspace = await getWorkspace(name, baseDirectory);
  const stages = await computeStageStatuses(workspace.path);
  return { workspace, stages };
}

export async function deleteWorkspace(
  name: string,
  baseDirectory = process.cwd(),
): Promise<Workspace> {
  const workspace = await getWorkspace(name, baseDirectory);
  await rm(workspace.path, { recursive: true });
  return workspace;
}

export interface WorkspaceListItem {
  name: string;
  prompt: string;
  title: string;
  playlist_name?: string;
  playlistImageUrl?: string;
  progress: number;
}

export async function listWorkspaces(
  baseDirectory = process.cwd(),
): Promise<WorkspaceListItem[]> {
  const root = getWorkspaceRoot(baseDirectory);

  let entries;
  try {
    entries = await readdir(root, { withFileTypes: true });
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return [];
    }
    throw error;
  }

  const items: WorkspaceListItem[] = [];

  for (const entry of entries) {
    if (!entry.isDirectory()) continue;

    const workspacePath = path.join(root, entry.name);
    const item: WorkspaceListItem = { name: entry.name, prompt: "", title: "生成中...", progress: 0 };

    try {
      const infoContent = await readFile(
        path.join(workspacePath, WORKSPACE_INFO_FILE),
        "utf8",
      );
      const info = JSON.parse(infoContent);
      item.prompt = info.prompt ?? "";
      if (info.title) {
        item.title = info.title;
      }
    } catch {
      // info.json missing or invalid
    }

    try {
      const playlistContent = await readFile(
        path.join(workspacePath, "playlist.json"),
        "utf8",
      );
      const playlist = JSON.parse(playlistContent);
      item.playlist_name = playlist.playlist?.name;
      item.playlistImageUrl = playlist.playlist?.imageUrl;
    } catch {
      // playlist.json missing or invalid
    }

    item.progress = await computeProgress(workspacePath);

    items.push(item);
  }

  return items;
}

export interface ShowTrack {
  id: string | number;
  name: string;
  artists: string[];
}

export interface WorkspaceShowDetail {
  name: string;
  title: string;
  playlist_name?: string;
  playlistImageUrl?: string;
  progress: number;
  tracks: ShowTrack[];
}

export async function getWorkspaceShowDetail(
  name: string,
  baseDirectory = process.cwd(),
): Promise<WorkspaceShowDetail> {
  const workspace = await getWorkspace(name, baseDirectory);

  const detail: WorkspaceShowDetail = {
    name: workspace.name,
    title: "生成中...",
    progress: 0,
    tracks: [],
  };

  let infoData: Record<string, unknown> | undefined;
  try {
    const infoContent = await readFile(
      path.join(workspace.path, WORKSPACE_INFO_FILE),
      "utf8",
    );
    infoData = JSON.parse(infoContent);
    if (infoData.title) {
      detail.title = infoData.title as string;
    }
  } catch {
    // info.json missing or invalid
  }

  let playlistData: Record<string, unknown> | undefined;
  try {
    const content = await readFile(
      path.join(workspace.path, "playlist.json"),
      "utf8",
    );
    playlistData = JSON.parse(content);
  } catch {
    // playlist.json missing
  }

  if (playlistData) {
    const playlist = playlistData.playlist as Record<string, unknown> | undefined;
    detail.playlist_name = playlist?.name as string | undefined;
    detail.playlistImageUrl = playlist?.imageUrl as string | undefined;

    const trackIds = infoData?.track_ids;
    if (Array.isArray(trackIds) && trackIds.length > 0) {
      const allTracks = playlist?.tracks as Array<Record<string, unknown>> | undefined;
      if (Array.isArray(allTracks)) {
        const trackMap = new Map(allTracks.map((t) => [t.id, t]));
        for (const trackId of trackIds) {
          const track = trackMap.get(trackId);
          if (track) {
            detail.tracks.push({
              id: track.id as string | number,
              name: track.name as string,
              artists: Array.isArray(track.artists)
                ? (track.artists as Array<Record<string, string>>).map(
                    (a) => a.name ?? "Unknown",
                  )
                : [],
            });
          }
        }
      }
    }
  }

  detail.progress = await computeProgress(workspace.path);

  return detail;
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
