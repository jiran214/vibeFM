import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { requestAiText, type AiMessage } from "./ai.js";
import { withAiLogging } from "./logger.js";
import { parseRadioScript, RadioScriptParseError } from "./radio-script.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

const INFO_FILE = "info.json";
const PLAYLIST_FILE = "playlist.json";
const SCRIPT_FILE = "script.md";
const DSL_FILE = "docs/dsl.md";
const SCRIPT_SYSTEM_PROMPT = "script.system.md";
const SCRIPT_USER_PROMPT = "script.user.md";
const SCRIPT_FORMAT = "radio-script-dsl" as const;
const REQUIRED_USER_PROMPT_PLACEHOLDERS = [
  "{{info_json}}",
  "{{plan_json}}",
  "{{tracks_json}}",
  "{{dsl_markdown}}",
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
  requestAi?: (messages: AiMessage[]) => Promise<string>;
  promptDirectory?: string;
  dslPath?: string;
}

interface ProgramPlanInput {
  think: string;
  track_ids: JsonId[];
}

interface PlaylistTrack {
  id: JsonId;
  title: string;
  artists: string[];
  album: string;
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
  const info = await readJsonDependency(
    path.join(workspace.path, INFO_FILE),
    INFO_FILE,
  );
  validateInfo(info);
  const plan = parsePlan(info);
  const playlist = parsePlaylist(
    await readJsonDependency(
      path.join(workspace.path, PLAYLIST_FILE),
      PLAYLIST_FILE,
    ),
  );
  const tracksById = new Map(
    playlist.map((track) => [canonicalId(track.id), track]),
  );
  const selectedTracks = plan.track_ids.map((id, index) => {
    const track = tracksById.get(canonicalId(id));
    if (track === undefined) {
      throw invalidDependency(
        `info.json track_ids contains a track outside playlist.json at index ${index}.`,
      );
    }
    return { order: index + 1, ...track };
  });

  const promptDirectory =
    options.promptDirectory ?? path.join(baseDirectory, "prompts");
  const [systemTemplate, userTemplate, dslMarkdown] = await Promise.all([
    readPromptTemplate(path.join(promptDirectory, SCRIPT_SYSTEM_PROMPT)),
    readPromptTemplate(path.join(promptDirectory, SCRIPT_USER_PROMPT)),
    readDsl(options.dslPath ?? path.join(baseDirectory, DSL_FILE)),
  ]);
  validateUserTemplate(userTemplate);

  const userPrompt = userTemplate
    .replaceAll("{{info_json}}", JSON.stringify(info))
    .replaceAll("{{plan_json}}", JSON.stringify(plan))
    .replaceAll("{{tracks_json}}", JSON.stringify(selectedTracks))
    .replaceAll("{{dsl_markdown}}", dslMarkdown.trim());
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
  const { text: scriptText, title } = validateRadioScript(
    await requestAi(messages),
    plan,
  );
  const artifactPath = path.join(workspace.path, SCRIPT_FILE);
  await writeTextAtomically(artifactPath, scriptText);

  return {
    workspace,
    path: artifactPath,
    trackCount: plan.track_ids.length,
    theme: title,
    format: SCRIPT_FORMAT,
  };
}

async function readJsonDependency(filePath: string, name: string): Promise<unknown> {
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
    throw invalidDependency(
      "info.json must be an object containing a non-empty prompt.",
    );
  }
}

function parsePlan(value: unknown): ProgramPlanInput {
  const root = asObject(value);
  const think = asNonEmptyString(root?.think);
  const rawTrackIds = Array.isArray(root?.track_ids)
    ? root.track_ids
    : undefined;
  if (
    root === undefined ||
    !Object.hasOwn(root, "think") ||
    !Object.hasOwn(root, "track_ids") ||
    think === undefined ||
    rawTrackIds === undefined ||
    rawTrackIds.length === 0
  ) {
    throw invalidDependency(
      "info.json must contain a non-empty think and track_ids array.",
    );
  }
  const trackIds = rawTrackIds.map((value, index) => {
    const id = asJsonId(value);
    if (id === undefined) {
      throw invalidDependency(
        `info.json contains an invalid track id at index ${index}.`,
      );
    }
    return id;
  });
  const canonicalIds = trackIds.map(canonicalId);
  if (new Set(canonicalIds).size !== canonicalIds.length) {
    throw invalidDependency("info.json contains duplicate track ids.");
  }
  return { think, track_ids: trackIds };
}

function parsePlaylist(value: unknown): PlaylistTrack[] {
  const playlist = asObject(asObject(value)?.playlist);
  const rawTracks = Array.isArray(playlist?.tracks) ? playlist.tracks : undefined;
  if (rawTracks === undefined || rawTracks.length === 0) {
    throw invalidDependency("playlist.json must contain a non-empty tracks array.");
  }
  const tracks = rawTracks.map((value, index): PlaylistTrack => {
    const track = asObject(value);
    const id = asJsonId(track?.id);
    const title = asNonEmptyString(track?.name);
    const rawArtists = Array.isArray(track?.artists) ? track.artists : undefined;
    const artists = rawArtists?.map((artist) =>
      asNonEmptyString(asObject(artist)?.name),
    );
    const album = asNonEmptyString(asObject(track?.album)?.name) ?? "Unknown album";
    if (
      id === undefined ||
      title === undefined ||
      artists === undefined ||
      artists.length === 0 ||
      artists.some((artist) => artist === undefined)
    ) {
      throw invalidDependency(
        `playlist.json contains an invalid track at index ${index}.`,
      );
    }
    return { id, title, artists: artists as string[], album };
  });
  const ids = tracks.map((track) => canonicalId(track.id));
  if (new Set(ids).size !== ids.length) {
    throw invalidDependency("playlist.json contains duplicate track ids.");
  }
  return tracks;
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
    if (error instanceof ScriptGenerationError) throw error;
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

async function readDsl(filePath: string): Promise<string> {
  try {
    const dsl = await readFile(filePath, "utf8");
    if (dsl.trim().length === 0) {
      throw invalidDependency(`${DSL_FILE} must not be empty.`);
    }
    return dsl;
  } catch (error) {
    if (error instanceof ScriptGenerationError) throw error;
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ScriptGenerationError(
        "MISSING_SCRIPT_DEPENDENCY",
        `Required script dependency ${DSL_FILE} does not exist.`,
      );
    }
    throw error;
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

function validateRadioScript(
  text: string,
  plan: ProgramPlanInput,
): { text: string; title: string } {
  let script;
  try {
    script = parseRadioScript(text);
  } catch (error) {
    if (error instanceof RadioScriptParseError) {
      throw invalidAiResponse(error.message, error);
    }
    throw error;
  }
  if (script.plays.length !== plan.track_ids.length) {
    throw invalidAiResponse(
      `AI script response has ${script.plays.length} main audio events but the plan has ${plan.track_ids.length} tracks.`,
    );
  }
  for (const [index, event] of script.plays.entries()) {
    const expectedSource = `/audio/${canonicalId(plan.track_ids[index])}.wav`;
    if (event.source !== expectedSource) {
      throw invalidAiResponse(
        `AI script response main audio at position ${index + 1} has source ${event.source} but expected ${expectedSource}.`,
      );
    }
  }
  const firstPlayLine = script.plays[0].line;
  const lastPlayLine = script.plays.at(-1)!.line;
  if (script.openingLine >= firstPlayLine) {
    throw invalidAiResponse("AI script response must place Opening before all songs.");
  }
  if (!script.hosts.some((host) => host.endLine < firstPlayLine)) {
    throw invalidAiResponse("AI script response is missing opening host content.");
  }
  for (let index = 1; index < script.plays.length; index += 1) {
    const previousPlayLine = script.plays[index - 1].line;
    const currentPlayLine = script.plays[index].line;
    if (
      !script.hosts.some(
        (host) => host.line > previousPlayLine && host.endLine < currentPlayLine,
      )
    ) {
      throw invalidAiResponse(
        `AI script response is missing host content before main audio ${index + 1}.`,
      );
    }
  }
  return { text: script.text, title: script.frontmatter.title };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as JsonObject
    : undefined;
}

function asNonEmptyString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : undefined;
}

function asJsonId(value: unknown): JsonId | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) return value;
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 0
    ? value
    : undefined;
}

function canonicalId(value: JsonId): string {
  return String(value);
}

function invalidDependency(message: string): ScriptGenerationError {
  return new ScriptGenerationError("INVALID_SCRIPT_DEPENDENCY", message);
}

function invalidAiResponse(message: string, cause?: unknown): ScriptGenerationError {
  return new ScriptGenerationError(
    "INVALID_AI_SCRIPT_RESPONSE",
    message,
    cause === undefined ? undefined : { cause },
  );
}

async function writeTextAtomically(filePath: string, value: string): Promise<void> {
  const temporaryPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(temporaryPath, value, { encoding: "utf8", flag: "wx" });
    await rename(temporaryPath, filePath);
  } finally {
    await rm(temporaryPath, { force: true });
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
