import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { requestAiText, type AiMessage } from "./ai.js";
import { withAiLogging } from "./logger.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

const INFO_FILE = "info.json";
const PLAYLIST_FILE = "playlist.json";
const PLAN_FILE = "plan.json";
const PLAN_SYSTEM_PROMPT = "plan.system.md";
const PLAN_USER_PROMPT = "plan.user.md";
const REQUIRED_USER_PROMPT_PLACEHOLDERS = [
  "{{count}}",
  "{{info_json}}",
  "{{playlist_json}}",
] as const;

export type PlanGenerationErrorCode =
  | "INVALID_TRACK_COUNT"
  | "MISSING_PLAN_DEPENDENCY"
  | "INVALID_PLAN_DEPENDENCY"
  | "PROMPT_TEMPLATE_ERROR"
  | "INVALID_AI_PLAN_RESPONSE";

export class PlanGenerationError extends Error {
  constructor(
    public readonly code: PlanGenerationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "PlanGenerationError";
  }
}

type JsonId = string | number;

export interface ProgramPlanResult {
  workspace: Workspace;
  path: string;
  trackCount: number;
  theme: string;
}

export interface GenerateProgramPlanOptions {
  now?: () => Date;
  requestAi?: (messages: AiMessage[]) => Promise<string>;
  promptDirectory?: string;
}

interface PlaylistTrack {
  id: JsonId;
  title: string;
  artists: string[];
  album: string;
}

interface PlaylistInput {
  id: JsonId;
  name: string;
  tracks: PlaylistTrack[];
}

interface AiPlanTrack {
  id: JsonId;
  selectionReason: string;
  emotion: string;
}

interface AiEmotionalStage {
  stage: string;
  description: string;
  trackIds: JsonId[];
}

interface AiProgramPlan {
  theme: {
    title: string;
    description: string;
  };
  hostStyle: {
    persona: string;
    tone: string;
    delivery: string;
  };
  emotionalArc: AiEmotionalStage[];
  tracks: AiPlanTrack[];
}

interface JsonObject {
  [key: string]: unknown;
}

export async function generateProgramPlan(
  workspaceName: string,
  count: number,
  baseDirectory = process.cwd(),
  options: GenerateProgramPlanOptions = {},
): Promise<ProgramPlanResult> {
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new PlanGenerationError(
      "INVALID_TRACK_COUNT",
      "Track count must be a positive integer.",
    );
  }

  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const info = await readDependency(
    path.join(workspace.path, INFO_FILE),
    INFO_FILE,
  );
  validateInfo(info);
  const playlist = parsePlaylist(
    await readDependency(
      path.join(workspace.path, PLAYLIST_FILE),
      PLAYLIST_FILE,
    ),
  );

  if (count > playlist.tracks.length) {
    throw new PlanGenerationError(
      "INVALID_TRACK_COUNT",
      `Track count ${count} exceeds playlist size ${playlist.tracks.length}.`,
    );
  }

  const promptDirectory =
    options.promptDirectory ?? path.join(baseDirectory, "prompts");
  const [systemTemplate, userTemplate] = await Promise.all([
    readPromptTemplate(path.join(promptDirectory, PLAN_SYSTEM_PROMPT)),
    readPromptTemplate(path.join(promptDirectory, PLAN_USER_PROMPT)),
  ]);
  validateUserTemplate(userTemplate);

  const compressedPlaylist = {
    id: playlist.id,
    name: playlist.name,
    tracks: playlist.tracks.map((track) => [
      track.id,
      track.title,
      track.artists,
      track.album,
    ]),
  };
  const userPrompt = userTemplate
    .replaceAll("{{count}}", String(count))
    .replaceAll("{{info_json}}", JSON.stringify(info))
    .replaceAll("{{playlist_json}}", JSON.stringify(compressedPlaylist));
  const messages: AiMessage[] = [
    { role: "system", content: systemTemplate.trim() },
    { role: "user", content: userPrompt.trim() },
  ];
  const requestAi =
    options.requestAi ??
    withAiLogging(
      (requestMessages: AiMessage[]) =>
        requestAiText(requestMessages, { baseDirectory, responseFormat: { type: "json_object" } }),
      baseDirectory,
      { task: "generate-plan", workspace: workspaceName },
    );
  const aiText = await requestAi(messages);
  const aiPlan = parseAiPlan(aiText, count, playlist);
  const tracksById = new Map(
    playlist.tracks.map((track) => [canonicalId(track.id), track]),
  );
  const artifact = {
    version: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    sourcePlaylist: { id: playlist.id, name: playlist.name },
    theme: aiPlan.theme,
    hostStyle: aiPlan.hostStyle,
    emotionalArc: aiPlan.emotionalArc.map((stage) => ({
      ...stage,
      trackIds: stage.trackIds.map(
        (id) => tracksById.get(canonicalId(id))!.id,
      ),
    })),
    tracks: aiPlan.tracks.map((selection, index) => {
      const track = tracksById.get(canonicalId(selection.id))!;
      return {
        order: index + 1,
        id: track.id,
        title: track.title,
        artists: track.artists,
        album: track.album,
        selectionReason: selection.selectionReason,
        emotion: selection.emotion,
      };
    }),
  };
  const artifactPath = path.join(workspace.path, PLAN_FILE);
  await writeJsonAtomically(artifactPath, artifact);

  return {
    workspace,
    path: artifactPath,
    trackCount: artifact.tracks.length,
    theme: artifact.theme.title,
  };
}

async function readDependency(filePath: string, name: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PlanGenerationError(
        "MISSING_PLAN_DEPENDENCY",
        `Required plan dependency ${name} does not exist.`,
      );
    }
    throw error;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new PlanGenerationError(
      "INVALID_PLAN_DEPENDENCY",
      `Required plan dependency ${name} is not valid JSON.`,
      { cause: error },
    );
  }
}

function validateInfo(value: unknown): asserts value is JsonObject {
  const info = asObject(value);
  if (info === undefined || asNonEmptyString(info.prompt) === undefined) {
    throw new PlanGenerationError(
      "INVALID_PLAN_DEPENDENCY",
      "info.json must be an object containing a non-empty prompt.",
    );
  }
}

function parsePlaylist(value: unknown): PlaylistInput {
  const root = asObject(value);
  const playlist = asObject(root?.playlist);
  const id = asJsonId(playlist?.id);
  const name = asNonEmptyString(playlist?.name);
  const rawTracks = Array.isArray(playlist?.tracks) ? playlist.tracks : undefined;

  if (id === undefined || name === undefined || rawTracks === undefined) {
    throw invalidPlaylistDependency();
  }

  const tracks = rawTracks.map((value, index) => {
    const track = asObject(value);
    const trackId = asJsonId(track?.id);
    const title = asNonEmptyString(track?.name);
    const rawArtists = Array.isArray(track?.artists) ? track.artists : undefined;
    const artists = rawArtists
      ?.map((artist) => asNonEmptyString(asObject(artist)?.name))
      .filter((artist): artist is string => artist !== undefined);
    const album = asNonEmptyString(asObject(track?.album)?.name) ?? "Unknown album";

    if (
      trackId === undefined ||
      title === undefined ||
      artists === undefined ||
      artists.length === 0 ||
      artists.length !== rawArtists?.length
    ) {
      throw new PlanGenerationError(
        "INVALID_PLAN_DEPENDENCY",
        `playlist.json contains an invalid track at index ${index}.`,
      );
    }

    return { id: trackId, title, artists, album };
  });
  const ids = tracks.map((track) => canonicalId(track.id));
  if (new Set(ids).size !== ids.length) {
    throw new PlanGenerationError(
      "INVALID_PLAN_DEPENDENCY",
      "playlist.json contains duplicate track ids.",
    );
  }

  return { id, name, tracks };
}

async function readPromptTemplate(filePath: string): Promise<string> {
  try {
    const template = await readFile(filePath, "utf8");
    if (template.trim().length === 0) {
      throw new PlanGenerationError(
        "PROMPT_TEMPLATE_ERROR",
        `Prompt template ${filePath} must not be empty.`,
      );
    }
    return template;
  } catch (error) {
    if (error instanceof PlanGenerationError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new PlanGenerationError(
        "PROMPT_TEMPLATE_ERROR",
        `Prompt template ${filePath} does not exist.`,
      );
    }
    throw new PlanGenerationError(
      "PROMPT_TEMPLATE_ERROR",
      `Unable to read prompt template ${filePath}.`,
      { cause: error },
    );
  }
}

function validateUserTemplate(template: string): void {
  const missing = REQUIRED_USER_PROMPT_PLACEHOLDERS.filter(
    (placeholder) => !template.includes(placeholder),
  );
  if (missing.length > 0) {
    throw new PlanGenerationError(
      "PROMPT_TEMPLATE_ERROR",
      `Plan user prompt is missing placeholders: ${missing.join(", ")}.`,
    );
  }
}

function parseAiPlan(
  text: string,
  count: number,
  playlist: PlaylistInput,
): AiProgramPlan {
  let value: unknown;
  try {
    value = JSON.parse(text);
  } catch (error) {
    throw invalidAiResponse("AI plan response is not valid JSON.", error);
  }

  const root = asObject(value);
  const theme = asObject(root?.theme);
  const hostStyle = asObject(root?.hostStyle);
  const rawArc = Array.isArray(root?.emotionalArc)
    ? root.emotionalArc
    : undefined;
  const rawTracks = Array.isArray(root?.tracks) ? root.tracks : undefined;
  const parsedTheme = {
    title: asNonEmptyString(theme?.title),
    description: asNonEmptyString(theme?.description),
  };
  const parsedHostStyle = {
    persona: asNonEmptyString(hostStyle?.persona),
    tone: asNonEmptyString(hostStyle?.tone),
    delivery: asNonEmptyString(hostStyle?.delivery),
  };

  if (
    Object.values(parsedTheme).includes(undefined) ||
    Object.values(parsedHostStyle).includes(undefined) ||
    rawArc === undefined ||
    rawArc.length === 0 ||
    rawTracks === undefined ||
    rawTracks.length !== count
  ) {
    throw invalidAiResponse(
      "AI plan response is missing required fields or has the wrong track count.",
    );
  }

  const playlistIds = new Set(
    playlist.tracks.map((track) => canonicalId(track.id)),
  );
  const tracks = rawTracks.map((value, index): AiPlanTrack => {
    const track = asObject(value);
    const id = asJsonId(track?.id);
    const selectionReason = asNonEmptyString(track?.selectionReason);
    const emotion = asNonEmptyString(track?.emotion);
    if (
      id === undefined ||
      selectionReason === undefined ||
      emotion === undefined ||
      !playlistIds.has(canonicalId(id))
    ) {
      throw invalidAiResponse(
        `AI plan response contains an invalid selected track at index ${index}.`,
      );
    }
    return { id, selectionReason, emotion };
  });
  const selectedIds = tracks.map((track) => canonicalId(track.id));
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw invalidAiResponse("AI plan response contains duplicate selected tracks.");
  }

  const emotionalArc = rawArc.map((value, index): AiEmotionalStage => {
    const stage = asObject(value);
    const stageName = asNonEmptyString(stage?.stage);
    const description = asNonEmptyString(stage?.description);
    const rawTrackIds = Array.isArray(stage?.trackIds)
      ? stage.trackIds
      : undefined;
    const trackIds = rawTrackIds?.map(asJsonId);
    if (
      stageName === undefined ||
      description === undefined ||
      trackIds === undefined ||
      trackIds.length === 0 ||
      trackIds.some((id) => id === undefined)
    ) {
      throw invalidAiResponse(
        `AI plan response contains an invalid emotional stage at index ${index}.`,
      );
    }
    return {
      stage: stageName,
      description,
      trackIds: trackIds as JsonId[],
    };
  });
  const arcIds = emotionalArc.flatMap((stage) =>
    stage.trackIds.map(canonicalId),
  );
  if (
    arcIds.length !== selectedIds.length ||
    new Set(arcIds).size !== arcIds.length ||
    arcIds.some((id) => !selectedIds.includes(id))
  ) {
    throw invalidAiResponse(
      "Emotional arc must reference every selected track exactly once.",
    );
  }

  return {
    theme: parsedTheme as AiProgramPlan["theme"],
    hostStyle: parsedHostStyle as AiProgramPlan["hostStyle"],
    emotionalArc,
    tracks,
  };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asJsonId(value: unknown): JsonId | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    return value;
  }
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function canonicalId(value: JsonId): string {
  return String(value);
}

function invalidPlaylistDependency(): PlanGenerationError {
  return new PlanGenerationError(
    "INVALID_PLAN_DEPENDENCY",
    "playlist.json must contain a playlist id, name, and tracks array.",
  );
}

function invalidAiResponse(message: string, cause?: unknown): PlanGenerationError {
  return new PlanGenerationError(
    "INVALID_AI_PLAN_RESPONSE",
    message,
    cause === undefined ? undefined : { cause },
  );
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
