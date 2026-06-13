import { readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import {
  parseRadioScript,
  RadioScriptParseError,
  type RadioScriptEvent,
} from "./radio-script.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

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

export interface HostEvent {
  type: "host";
  id: string;
  voiceDesignPrompt: string;
  text: string;
}

export interface PlayEvent {
  type: "play";
  id: string;
  fadeIn?: number;
  fadeOut?: number;
}

export interface BgmStartEvent {
  type: "bgm";
  action: "start";
  name: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface BgmStopEvent {
  type: "bgm";
  action: "stop";
  fadeOut?: number;
}

export interface SfxEvent {
  type: "sfx";
  name: string;
  volume?: number;
}

export interface PauseEvent {
  type: "pause";
  duration: number;
}

export interface TransitionEvent {
  type: "transition";
  transitionType: "soft" | "fade" | "radio" | "whoosh" | "silence" | "cut";
  duration: number;
}

export type RadioEvent =
  | HostEvent
  | PlayEvent
  | BgmStartEvent
  | BgmStopEvent
  | SfxEvent
  | PauseEvent
  | TransitionEvent;

export interface ProgramEventsResult {
  workspace: Workspace;
  path: string;
  eventCount: number;
  hostCount: number;
  playCount: number;
}

export function parseRadioEvents(scriptText: string): RadioEvent[] {
  let sourceEvents: RadioScriptEvent[];
  try {
    sourceEvents = parseRadioScript(scriptText).events;
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
  return sourceEvents.map((event): RadioEvent => {
    switch (event.type) {
      case "host":
        hostIndex += 1;
        return {
          type: "host",
          id: `host-${String(hostIndex).padStart(3, "0")}`,
          voiceDesignPrompt: event.voiceDesignPrompt,
          text: event.text,
        };
      case "play":
        return compact({
          type: "play",
          id: event.id,
          fadeIn: event.fadeIn,
          fadeOut: event.fadeOut,
        });
      case "bgm":
        return event.action === "start"
          ? compact({
              type: "bgm",
              action: "start",
              name: event.name,
              volume: event.volume,
              fadeIn: event.fadeIn,
              fadeOut: event.fadeOut,
            })
          : compact({
              type: "bgm",
              action: "stop",
              fadeOut: event.fadeOut,
            });
      case "sfx":
        return compact({
          type: "sfx",
          name: event.name,
          volume: event.volume,
        });
      case "pause":
        return { type: "pause", duration: event.duration };
      case "transition":
        return {
          type: "transition",
          transitionType: event.transitionType,
          duration: event.duration,
        };
    }
  });
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
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

  const events = parseRadioEvents(scriptText);
  const artifactPath = path.join(workspace.path, EVENTS_FILE);
  await writeJsonAtomically(artifactPath, events);

  return {
    workspace,
    path: artifactPath,
    eventCount: events.length,
    hostCount: events.filter((event) => event.type === "host").length,
    playCount: events.filter((event) => event.type === "play").length,
  };
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

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
