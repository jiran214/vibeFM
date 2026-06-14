import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { requestAiText, type AiMessage } from "./ai.js";
import { withAiLogging } from "./logger.js";
import { parseRadioScript, RadioScriptParseError } from "./radio-script.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

const INFO_FILE = "info.json";
const PLAN_FILE = "plan.json";
const SCRIPT_FILE = "script.md";
const SCRIPT_SYSTEM_PROMPT = "script.system.md";
const SCRIPT_USER_PROMPT = "script.user.md";
const SCRIPT_FORMAT = "radio-script-dsl" as const;
const REQUIRED_USER_PROMPT_PLACEHOLDERS = [
  "{{info_json}}",
  "{{plan_json}}",
] as const;

export type ScriptGenerationErrorCode =
  | "MISSING_SCRIPT_DEPENDENCY"
  | "INVALID_SCRIPT_DEPENDENCY"
  | "PROMPT_TEMPLATE_ERROR"
  | "INVALID_AI_SCRIPT_RESPONSE";

export class ScriptGenerationError extends Error {
  constructor(
    public readonly code: ScriptGenerationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ScriptGenerationError";
  }
}

type JsonId = string | number;

export interface ProgramScriptResult {
  workspace: Workspace;
  path: string;
  trackCount: number;
  theme: string;
  format: typeof SCRIPT_FORMAT;
}

export interface GenerateProgramScriptOptions {
  now?: () => Date;
  requestAi?: (messages: AiMessage[]) => Promise<string>;
  promptDirectory?: string;
}

interface ProgramPlanTrack {
  order: number;
  id: JsonId;
  title: string;
  artists: string[];
  album: string;
  selectionReason: string;
  emotion: string;
}

interface EmotionalStage {
  stage: string;
  description: string;
  trackIds: JsonId[];
}

interface ProgramPlanInput {
  generatedAt: string;
  theme: {
    title: string;
    description: string;
  };
  hostStyle: {
    persona: string;
    tone: string;
    delivery: string;
  };
  emotionalArc: EmotionalStage[];
  tracks: ProgramPlanTrack[];
}

interface JsonObject {
  [key: string]: unknown;
}

export async function generateProgramScript(
  workspaceName: string,
  baseDirectory = process.cwd(),
  options: GenerateProgramScriptOptions = {},
): Promise<ProgramScriptResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const info = await readDependency(
    path.join(workspace.path, INFO_FILE),
    INFO_FILE,
  );
  validateInfo(info);
  const plan = parsePlan(
    await readDependency(path.join(workspace.path, PLAN_FILE), PLAN_FILE),
  );

  const promptDirectory =
    options.promptDirectory ?? path.join(baseDirectory, "prompts");
  const [systemTemplate, userTemplate] = await Promise.all([
    readPromptTemplate(path.join(promptDirectory, SCRIPT_SYSTEM_PROMPT)),
    readPromptTemplate(path.join(promptDirectory, SCRIPT_USER_PROMPT)),
  ]);
  validateUserTemplate(userTemplate);

  const promptPlan = {
    theme: plan.theme,
    hostStyle: plan.hostStyle,
    emotionalArc: plan.emotionalArc,
    tracks: plan.tracks,
  };
  const userPrompt = userTemplate
    .replaceAll("{{info_json}}", JSON.stringify(info))
    .replaceAll("{{plan_json}}", JSON.stringify(promptPlan));
  const messages: AiMessage[] = [
    { role: "system", content: systemTemplate.trim() },
    { role: "user", content: userPrompt.trim() },
  ];
  const requestAi =
    options.requestAi ??
    withAiLogging(
      (requestMessages: AiMessage[]) =>
        requestAiText(requestMessages, { baseDirectory }),
      baseDirectory,
      { task: "generate-script", workspace: workspaceName },
    );
  const scriptText = validateRadioScript(await requestAi(messages), plan);
  const artifactPath = path.join(workspace.path, SCRIPT_FILE);
  await writeTextAtomically(artifactPath, scriptText);

  return {
    workspace,
    path: artifactPath,
    trackCount: plan.tracks.length,
    theme: plan.theme.title,
    format: SCRIPT_FORMAT,
  };
}

async function readDependency(filePath: string, name: string): Promise<unknown> {
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ScriptGenerationError(
        "MISSING_SCRIPT_DEPENDENCY",
        `Required script dependency ${name} does not exist.`,
      );
    }
    throw error;
  }

  try {
    return JSON.parse(content);
  } catch (error) {
    throw new ScriptGenerationError(
      "INVALID_SCRIPT_DEPENDENCY",
      `Required script dependency ${name} is not valid JSON.`,
      { cause: error },
    );
  }
}

function validateInfo(value: unknown): asserts value is JsonObject {
  const info = asObject(value);
  if (info === undefined || asNonEmptyString(info.prompt) === undefined) {
    throw new ScriptGenerationError(
      "INVALID_SCRIPT_DEPENDENCY",
      "info.json must be an object containing a non-empty prompt.",
    );
  }
}

function parsePlan(value: unknown): ProgramPlanInput {
  const root = asObject(value);
  const sourcePlaylist = asObject(root?.sourcePlaylist);
  const theme = asObject(root?.theme);
  const hostStyle = asObject(root?.hostStyle);
  const rawArc = Array.isArray(root?.emotionalArc)
    ? root.emotionalArc
    : undefined;
  const rawTracks = Array.isArray(root?.tracks) ? root.tracks : undefined;
  const generatedAt = asIsoDateString(root?.generatedAt);
  const sourcePlaylistId = asJsonId(sourcePlaylist?.id);
  const sourcePlaylistName = asNonEmptyString(sourcePlaylist?.name);
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
    root?.version !== 1 ||
    generatedAt === undefined ||
    sourcePlaylistId === undefined ||
    sourcePlaylistName === undefined ||
    Object.values(parsedTheme).includes(undefined) ||
    Object.values(parsedHostStyle).includes(undefined) ||
    rawArc === undefined ||
    rawArc.length === 0 ||
    rawTracks === undefined ||
    rawTracks.length === 0
  ) {
    throw invalidPlanDependency(
      "plan.json is missing required program plan fields.",
    );
  }

  const tracks = rawTracks.map((value, index): ProgramPlanTrack => {
    const track = asObject(value);
    const id = asJsonId(track?.id);
    const title = asNonEmptyString(track?.title);
    const rawArtists = Array.isArray(track?.artists)
      ? track.artists
      : undefined;
    const artists = rawArtists?.map(asNonEmptyString);
    const album = asNonEmptyString(track?.album);
    const selectionReason = asNonEmptyString(track?.selectionReason);
    const emotion = asNonEmptyString(track?.emotion);
    if (
      track?.order !== index + 1 ||
      id === undefined ||
      title === undefined ||
      artists === undefined ||
      artists.length === 0 ||
      artists.some((artist) => artist === undefined) ||
      album === undefined ||
      selectionReason === undefined ||
      emotion === undefined
    ) {
      throw invalidPlanDependency(
        `plan.json contains an invalid track at index ${index}.`,
      );
    }
    return {
      order: index + 1,
      id,
      title,
      artists: artists as string[],
      album,
      selectionReason,
      emotion,
    };
  });
  const selectedIds = tracks.map((track) => canonicalId(track.id));
  if (new Set(selectedIds).size !== selectedIds.length) {
    throw invalidPlanDependency("plan.json contains duplicate track ids.");
  }

  const emotionalArc = rawArc.map((value, index): EmotionalStage => {
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
      throw invalidPlanDependency(
        `plan.json contains an invalid emotional stage at index ${index}.`,
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
    throw invalidPlanDependency(
      "plan.json emotional arc must reference every selected track exactly once.",
    );
  }

  return {
    generatedAt,
    theme: parsedTheme as ProgramPlanInput["theme"],
    hostStyle: parsedHostStyle as ProgramPlanInput["hostStyle"],
    emotionalArc,
    tracks,
  };
}

async function readPromptTemplate(filePath: string): Promise<string> {
  try {
    const template = await readFile(filePath, "utf8");
    if (template.trim().length === 0) {
      throw new ScriptGenerationError(
        "PROMPT_TEMPLATE_ERROR",
        `Prompt template ${filePath} must not be empty.`,
      );
    }
    return template;
  } catch (error) {
    if (error instanceof ScriptGenerationError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ScriptGenerationError(
        "PROMPT_TEMPLATE_ERROR",
        `Prompt template ${filePath} does not exist.`,
      );
    }
    throw new ScriptGenerationError(
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
    throw new ScriptGenerationError(
      "PROMPT_TEMPLATE_ERROR",
      `Script user prompt is missing placeholders: ${missing.join(", ")}.`,
    );
  }
}

function validateRadioScript(text: string, plan: ProgramPlanInput): string {
  let script;
  try {
    script = parseRadioScript(text);
  } catch (error) {
    if (error instanceof RadioScriptParseError) {
      throw invalidAiResponse(error.message, error);
    }
    throw error;
  }
  if (script.plays.length !== plan.tracks.length) {
    throw invalidAiResponse(
      `AI script response has ${script.plays.length} play events but the plan has ${plan.tracks.length} tracks.`,
    );
  }
  for (const [index, event] of script.plays.entries()) {
    if (canonicalId(event.id) !== canonicalId(plan.tracks[index].id)) {
      throw invalidAiResponse(
        `AI script response play event at position ${index + 1} has id ${event.id} but expected ${plan.tracks[index].id}.`,
      );
    }
  }
  const firstPlayLine = script.plays[0].line;
  const lastPlayLine = script.plays[script.plays.length - 1].line;
  if (script.openingLine >= firstPlayLine) {
    throw invalidAiResponse(
      "AI script response must place Opening before all songs",
    );
  }
  if (!script.hosts.some((host) => host.endLine < firstPlayLine)) {
    throw invalidAiResponse("AI script response is missing opening host content.");
  }
  for (let index = 1; index < script.plays.length; index += 1) {
    const previousPlayLine = script.plays[index - 1].line;
    const currentPlayLine = script.plays[index].line;
    if (
      !script.hosts.some(
        (host) =>
          host.line > previousPlayLine && host.endLine < currentPlayLine,
      )
    ) {
      throw invalidAiResponse(
        `AI script response is missing host content before play event ${index + 1}.`,
      );
    }
  }
  if (!script.hosts.some((host) => host.line > lastPlayLine)) {
    throw invalidAiResponse("AI script response is missing ending host content.");
  }

  return script.text;
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

function asIsoDateString(value: unknown): string | undefined {
  const text = asNonEmptyString(value);
  if (text === undefined) {
    return undefined;
  }
  const date = new Date(text);
  return !Number.isNaN(date.valueOf()) && date.toISOString() === text
    ? text
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

function invalidPlanDependency(message: string): ScriptGenerationError {
  return new ScriptGenerationError("INVALID_SCRIPT_DEPENDENCY", message);
}

function invalidAiResponse(
  message: string,
  cause?: unknown,
): ScriptGenerationError {
  return new ScriptGenerationError(
    "INVALID_AI_SCRIPT_RESPONSE",
    message,
    cause === undefined ? undefined : { cause },
  );
}

async function writeTextAtomically(filePath: string, content: string) {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, content, {
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
