import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { getWorkspace, type Workspace } from "./workspaces.js";
import {
  synthesizeSpeech as defaultSynthesizeSpeech,
  decodeAudioData,
  type TtsVoice,
} from "./tts.js";

const EVENTS_FILE = "events.json";
const SPEECH_DIR = "speech";

export type SpeechGenerationErrorCode =
  | "MISSING_SPEECH_DEPENDENCY"
  | "INVALID_SPEECH_DEPENDENCY"
  | "TTS_SYNTHESIS_FAILED";

export class SpeechGenerationError extends Error {
  constructor(
    public readonly code: SpeechGenerationErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "SpeechGenerationError";
  }
}

export interface SpeechGenerationResult {
  workspace: Workspace;
  directory: string;
  manifest: string;
  segmentCount: number;
  synthesizedCount: number;
  placeholderCount: number;
  warnings: string[];
}

export interface GenerateSpeechOptions {
  voice?: TtsVoice;
  force?: boolean;
  synthesizeSpeech?: typeof defaultSynthesizeSpeech;
  now?: () => Date;
}

interface SpeechSegment {
  index: number;
  eventIndex: number;
  id: string;
  text: string;
  voiceDesignPrompt: string;
  fileName: string;
}

interface ManifestSegment {
  index: number;
  id: string;
  text: string;
  voiceDesignPrompt: string;
  status: "synthesized" | "placeholder";
  filePath: string;
  error?: string;
}

interface Manifest {
  version: 1;
  generatedAt: string;
  voice: string;
  segments: ManifestSegment[];
}

interface ParsedSpeechEvents {
  events: Record<string, unknown>[];
  segments: SpeechSegment[];
}

export function parseEventsToSpeechSegments(eventsText: string): SpeechSegment[] {
  return parseSpeechEvents(eventsText).segments;
}

function parseSpeechEvents(eventsText: string): ParsedSpeechEvents {
  let parsed: unknown;
  try {
    parsed = JSON.parse(eventsText);
  } catch (error) {
    throw new SpeechGenerationError(
      "INVALID_SPEECH_DEPENDENCY",
      `${EVENTS_FILE} is not valid JSON.`,
      { cause: error },
    );
  }
  if (!Array.isArray(parsed)) {
    throw new SpeechGenerationError(
      "INVALID_SPEECH_DEPENDENCY",
      `${EVENTS_FILE} must contain an event array.`,
    );
  }

  const events: Record<string, unknown>[] = [];
  const hosts: Array<Omit<SpeechSegment, "index" | "fileName">> = [];
  const hostIds = new Set<string>();

  for (const [eventIndex, value] of parsed.entries()) {
    const event = asObject(value);
    if (event === undefined) {
      throw invalidEvent(eventIndex, "must be an object");
    }
    validateStoredEvent(event, eventIndex);
    events.push(event);
    if (event.type !== "audio" || event.role !== "host") continue;

    const id = readNonEmptyString(event.id);
    const text = readNonEmptyString(event.text);
    const voiceDesignPrompt = readNonEmptyString(event.voiceDesignPrompt);
    if (id === undefined || !/^host-\d{3,}$/u.test(id)) {
      throw invalidEvent(eventIndex, "requires an id such as host-001");
    }
    if (text === undefined || voiceDesignPrompt === undefined) {
      throw invalidEvent(eventIndex, "requires text and voiceDesignPrompt");
    }
    if (hostIds.has(id)) {
      throw invalidEvent(eventIndex, `duplicates host id ${id}`);
    }
    hostIds.add(id);
    hosts.push({ eventIndex, id, text, voiceDesignPrompt });
  }

  if (hosts.length === 0) {
    throw new SpeechGenerationError(
      "INVALID_SPEECH_DEPENDENCY",
      `${EVENTS_FILE} contains no host audio events.`,
    );
  }

  return {
    events,
    segments: hosts.map((host, index) => ({
      index,
      ...host,
      fileName: `${host.id}.wav`,
    })),
  };
}

export async function generateSpeech(
  workspaceName: string,
  baseDirectory = process.cwd(),
  options: GenerateSpeechOptions = {},
): Promise<SpeechGenerationResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const eventsPath = path.join(workspace.path, EVENTS_FILE);
  let eventsText: string;
  try {
    eventsText = await readFile(eventsPath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new SpeechGenerationError(
        "MISSING_SPEECH_DEPENDENCY",
        `Required speech dependency ${EVENTS_FILE} does not exist.`,
      );
    }
    throw error;
  }

  const { events, segments } = parseSpeechEvents(eventsText);
  const speechDir = path.join(workspace.path, SPEECH_DIR);
  await mkdir(speechDir, { recursive: true });
  const voice = options.voice ?? "冰糖";
  const synthesize = options.synthesizeSpeech ?? defaultSynthesizeSpeech;
  const manifestSegments: ManifestSegment[] = [];

  for (const segment of segments) {
    const wavPath = path.join(speechDir, segment.fileName);

    if (options.force || !(await fileExists(wavPath))) {
      const result = await synthesize(segment.text.toLowerCase(), voice, {
        baseDirectory,
        voiceDesignPrompt: segment.voiceDesignPrompt,
        workspace: workspaceName,
      }).catch((error) => {
        throw new SpeechGenerationError(
          "TTS_SYNTHESIS_FAILED",
          `Failed to synthesize host event ${segment.id}: ${error instanceof Error ? error.message : "Unknown error"}`,
          { cause: error },
        );
      });
      await writeWavAtomically(wavPath, decodeAudioData(result.audioData));
    }

    manifestSegments.push({
      index: segment.index,
      id: segment.id,
      text: segment.text,
      voiceDesignPrompt: segment.voiceDesignPrompt,
      status: "synthesized",
      filePath: segment.fileName,
    });
    events[segment.eventIndex].source = `/${SPEECH_DIR}/${segment.fileName}`;
  }

  const manifestPath = path.join(speechDir, "manifest.json");
  const manifestData: Manifest = {
    version: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    voice,
    segments: manifestSegments,
  };
  await writeJsonAtomically(manifestPath, manifestData);
  await writeJsonAtomically(eventsPath, events);

  return {
    workspace,
    directory: speechDir,
    manifest: manifestPath,
    segmentCount: segments.length,
    synthesizedCount: segments.length,
    placeholderCount: 0,
    warnings: [],
  };
}

function validateStoredEvent(
  event: Record<string, unknown>,
  eventIndex: number,
): void {
  if (event.type === "pause" || event.type === "crossfade") {
    validateRequiredNumber(event.duration, eventIndex, "duration", 0, false);
    return;
  }
  if (event.type !== "audio") {
    throw invalidEvent(eventIndex, "has an invalid type");
  }
  if (!(["host", "main", "bed", "effect"] as const).includes(event.role as never)) {
    throw invalidEvent(eventIndex, "has an invalid audio role");
  }
  if (event.role === "host") {
    if (typeof event.source !== "string") {
      throw invalidEvent(eventIndex, "requires a source string");
    }
    validateOptionalNumber(event.duckTo, eventIndex, "duckTo", 0, 1);
    validateOptionalNumber(event.duckFade, eventIndex, "duckFade", 0);
    return;
  }
  if (event.role === "bed") {
    if (event.action !== "start" && event.action !== "stop") {
      throw invalidEvent(eventIndex, "requires a bed action");
    }
    if (event.action === "start" && readNonEmptyString(event.source) === undefined) {
      throw invalidEvent(eventIndex, "requires a bed source");
    }
  } else if (readNonEmptyString(event.source) === undefined) {
    throw invalidEvent(eventIndex, "requires a source");
  }
  validateOptionalNumber(event.start, eventIndex, "start", 0);
  validateOptionalNumber(event.duration, eventIndex, "duration", 0);
  validateOptionalNumber(event.volume, eventIndex, "volume", 0, 1);
  validateOptionalNumber(event.fadeIn, eventIndex, "fadeIn", 0);
  validateOptionalNumber(event.fadeOut, eventIndex, "fadeOut", 0);
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function readNonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function validateOptionalNumber(
  value: unknown,
  eventIndex: number,
  field: string,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): void {
  if (value !== undefined) {
    validateRequiredNumber(value, eventIndex, field, minimum, true, maximum);
  }
}

function validateRequiredNumber(
  value: unknown,
  eventIndex: number,
  field: string,
  minimum: number,
  includeMinimum: boolean,
  maximum = Number.POSITIVE_INFINITY,
): void {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (includeMinimum ? value < minimum : value <= minimum) ||
    value > maximum
  ) {
    throw invalidEvent(eventIndex, `has an invalid ${field}`);
  }
}

function invalidEvent(eventIndex: number, detail: string): SpeechGenerationError {
  return new SpeechGenerationError(
    "INVALID_SPEECH_DEPENDENCY",
    `${EVENTS_FILE} event at index ${eventIndex} ${detail}.`,
  );
}

function createSilentWav(): Buffer {
  const sampleRate = 44100;
  const channels = 1;
  const bitsPerSample = 16;
  const dataSize = sampleRate * channels * (bitsPerSample / 8);
  const wav = Buffer.alloc(44 + dataSize);
  wav.write("RIFF", 0);
  wav.writeUInt32LE(36 + dataSize, 4);
  wav.write("WAVE", 8);
  wav.write("fmt ", 12);
  wav.writeUInt32LE(16, 16);
  wav.writeUInt16LE(1, 20);
  wav.writeUInt16LE(channels, 22);
  wav.writeUInt32LE(sampleRate, 24);
  wav.writeUInt32LE(sampleRate * channels * (bitsPerSample / 8), 28);
  wav.writeUInt16LE(channels * (bitsPerSample / 8), 32);
  wav.writeUInt16LE(bitsPerSample, 34);
  wav.write("data", 36);
  wav.writeUInt32LE(dataSize, 40);
  return wav;
}

async function writeWavAtomically(filePath: string, data: Buffer): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, data, { flag: "wx" });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
