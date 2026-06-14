import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseRadioScript,
  RadioScriptParseError,
  type RadioScriptEvent,
  type RadioScriptFrontmatter,
} from "./radio-script.js";
import {
  getWorkspace,
  WORKSPACE_INFO_FILE,
  type Workspace,
} from "./workspaces.js";

const SCRIPT_FILE = "script.md";
const EVENTS_FILE = "events.json";

export type EventGenerationErrorCode =
  | "MISSING_EVENTS_DEPENDENCY"
  | "INVALID_EVENTS_DEPENDENCY";

export class EventGenerationError extends Error {
  constructor(
    public readonly code: EventGenerationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "EventGenerationError";
  }
}

export interface HostAudioEvent {
  type: "audio";
  id: string;
  source: string;
  role: "host";
  voiceDesignPrompt: string;
  text: string;
  duckTo?: number;
  duckFade?: number;
}

export interface MainAudioEvent {
  type: "audio";
  source: string;
  role: "main";
  start?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface EffectAudioEvent {
  type: "audio";
  source: string;
  role: "effect";
  start?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface BedAudioStartEvent {
  type: "audio";
  action: "start";
  source: string;
  role: "bed";
  start?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface BedAudioStopEvent {
  type: "audio";
  action: "stop";
  role: "bed";
}

export type AudioEvent =
  | HostAudioEvent
  | MainAudioEvent
  | EffectAudioEvent
  | BedAudioStartEvent
  | BedAudioStopEvent;

export interface PauseEvent {
  type: "pause";
  duration: number;
}

export interface CrossfadeEvent {
  type: "crossfade";
  duration: number;
}

export type RadioEvent = AudioEvent | PauseEvent | CrossfadeEvent;

export interface ProgramEventsResult {
  workspace: Workspace;
  path: string;
  eventCount: number;
  hostCount: number;
  playCount: number;
  frontmatter: RadioScriptFrontmatter;
}

export interface ParsedRadioEvents {
  events: RadioEvent[];
  frontmatter: RadioScriptFrontmatter;
}

export function parseRadioEvents(scriptText: string): ParsedRadioEvents {
  let sourceEvents: RadioScriptEvent[];
  let frontmatter: RadioScriptFrontmatter;
  try {
    const doc = parseRadioScript(scriptText);
    sourceEvents = doc.events;
    frontmatter = doc.frontmatter;
  } catch (error) {
    if (error instanceof RadioScriptParseError) {
      throw new EventGenerationError(
        "INVALID_EVENTS_DEPENDENCY",
        error.message,
        { cause: error },
      );
    }
    throw error;
  }

  let hostIndex = 0;
  const events = sourceEvents.map((event): RadioEvent => {
    if (event.type === "host") {
      hostIndex += 1;
      return compact({
        type: "audio" as const,
        id: `host-${String(hostIndex).padStart(3, "0")}`,
        source: "",
        role: "host" as const,
        voiceDesignPrompt: event.voiceDesignPrompt,
        text: event.text,
        duckTo: event.duckTo,
        duckFade: event.duckFade,
      });
    }
    if (event.type === "pause" || event.type === "crossfade") {
      return { type: event.type, duration: event.duration };
    }
    if (event.role === "bed" && event.action === "stop") {
      return { type: "audio", action: "stop", role: "bed" };
    }
    return compact({
      type: "audio" as const,
      action: event.action,
      source: event.source!,
      role: event.role,
      start: event.start,
      duration: event.duration,
      volume: event.volume,
      fadeIn: event.fadeIn,
      fadeOut: event.fadeOut,
    }) as RadioEvent;
  });
  return { events, frontmatter };
}

export async function generateProgramEvents(
  workspaceName: string,
  baseDirectory = process.cwd(),
): Promise<ProgramEventsResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const scriptPath = path.join(workspace.path, SCRIPT_FILE);
  let scriptText: string;
  try {
    scriptText = await readFile(scriptPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new EventGenerationError(
        "MISSING_EVENTS_DEPENDENCY",
        `Required events dependency ${SCRIPT_FILE} does not exist.`,
      );
    }
    throw error;
  }

  const { events, frontmatter } = parseRadioEvents(scriptText);
  const artifactPath = path.join(workspace.path, EVENTS_FILE);
  await writeJsonAtomically(artifactPath, events);

  const infoPath = path.join(workspace.path, WORKSPACE_INFO_FILE);
  const existingInfo = await readJsonFile(infoPath);
  if (existingInfo && typeof existingInfo === "object" && !Array.isArray(existingInfo)) {
    const updatedInfo = { ...existingInfo, ...frontmatter };
    await writeJsonAtomically(infoPath, updatedInfo);
  }

  return {
    workspace,
    path: artifactPath,
    eventCount: events.length,
    hostCount: events.filter(
      (event) => event.type === "audio" && event.role === "host",
    ).length,
    playCount: events.filter(
      (event) => event.type === "audio" && event.role === "main",
    ).length,
    frontmatter,
  };
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
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

async function readJsonFile(filePath: string): Promise<unknown> {
  try {
    const content = await readFile(filePath, "utf8");
    return JSON.parse(content);
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return null;
    }
    throw error;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
