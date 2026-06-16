import { spawn } from "node:child_process";
import {
  mkdir,
  readFile,
  rename,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import path from "node:path";

import type { RadioEvent } from "./events.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

const EVENTS_FILE = "events.json";
const PLAYLIST_FILE = "playlist.json";
const OUTPUT_DIRECTORY = "output";
const OUTPUT_FILE = "program.mp3";
const SUBTITLE_FILE = "program.srt";
const MANIFEST_FILE = "manifest.json";
const SAMPLE_RATE = 48_000;
const CHANNELS = 2;
const BITRATE = "192k";
const DEFAULT_HOST_GAP = 0.3;
const ASSET_EXTENSIONS = [
  ".wav",
  ".mp3",
  ".m4a",
  ".aac",
  ".flac",
  ".ogg",
  ".opus",
];
const EVENT_TYPES = new Set(["audio", "pause", "crossfade"]);

export type ProgramRenderErrorCode =
  | "MISSING_RENDER_DEPENDENCY"
  | "INVALID_RENDER_DEPENDENCY"
  | "FFMPEG_NOT_FOUND"
  | "RENDER_FAILED";

export class ProgramRenderError extends Error {
  constructor(
    public readonly code: ProgramRenderErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "ProgramRenderError";
  }
}

export interface ProgramRenderResult {
  workspace: Workspace;
  path: string;
  subtitles: string;
  manifest: string;
  durationSeconds: number;
  eventCount: number;
  inputCount: number;
}

export type FfmpegExecutor = (
  args: string[],
  executable?: string,
) => Promise<void>;

export type DurationProbe = (
  filePath: string,
  executable?: string,
) => Promise<number>;

export interface GenerateProgramRenderOptions {
  ffmpegPath?: string;
  ffprobePath?: string;
  assetsDirectory?: string;
  executeFfmpeg?: FfmpegExecutor;
  probeDuration?: DurationProbe;
  now?: () => Date;
  speechRate?: number;
  hostGap?: number;
  hostVolume?: number;
}

interface FileSegment {
  type: "file";
  filePath: string;
  duration: number;
  start?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
  loop?: boolean;
  crossfadeBefore?: number;
  speechRate?: number;
}

interface SilenceSegment {
  type: "silence";
  duration: number;
  crossfadeBefore?: number;
}

type TimelineSegment = FileSegment | SilenceSegment;

interface ActiveBgm {
  source: string;
  filePath: string;
  startAt: number;
  sourceStart: number;
  volume: number;
  fadeIn: number;
  fadeOut: number;
  ducks: DuckSpan[];
}

interface BgmSpan extends ActiveBgm {
  duration: number;
}

interface DuckSpan {
  startAt: number;
  duration: number;
  volume: number;
  fade: number;
}

interface RenderGraph {
  args: string[];
  filterGraph: string;
  inputCount: number;
}

interface SubtitleCue {
  start: number;
  end: number;
  text: string;
}

export async function generateProgramRender(
  workspaceName: string,
  baseDirectory = process.cwd(),
  options: GenerateProgramRenderOptions = {},
): Promise<ProgramRenderResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const events = parseStoredEvents(
    await readRequiredFile(
      path.join(workspace.path, EVENTS_FILE),
      `Required render dependency ${EVENTS_FILE} does not exist.`,
    ),
  );

  const hostIds = new Set(
    events
      .filter((event) => event.type === "audio" && event.role === "host")
      .map((event) => event.id),
  );
  const trackIds = new Set(
    events
      .filter(
        (event) =>
          event.type === "audio" &&
          (event.role === "main" ||
            (event.role === "bed" && event.action === "start")),
      )
      .map((event) => trackIdFromSource(event.source))
      .filter((id): id is string => id !== undefined),
  );
  const mainTrackIds = new Set(
    events
      .filter((event) => event.type === "audio" && event.role === "main")
      .map((event) => trackIdFromSource(event.source))
      .filter((id): id is string => id !== undefined),
  );
  const trackTitles = mainTrackIds.size === 0
    ? new Map<string, string>()
    : await readTrackTitles(
        path.join(workspace.path, PLAYLIST_FILE),
        mainTrackIds,
      );
  const speechMedia = hostIds.size === 0
    ? new Map<string, string>()
    : await readMediaManifest(
        path.join(workspace.path, "speech"),
        "segments",
        hostIds,
        "synthesized",
        "speech",
      );
  const trackMedia = trackIds.size === 0
    ? new Map<string, string>()
    : await readMediaManifest(
        path.join(workspace.path, "audio"),
        "tracks",
        trackIds,
        "downloaded",
        "audio",
      );

  const probeDuration = options.probeDuration ?? defaultProbeDuration;
  const assetsDirectory =
    options.assetsDirectory ?? path.join(baseDirectory, "assets");
  const speechRate = options.speechRate ?? 1.3;
  const hostGap = options.hostGap ?? DEFAULT_HOST_GAP;
  const hostVolume = options.hostVolume ?? 4;
  const { segments, bgmSpans, subtitleCues } = await buildTimeline(
    events,
    speechMedia,
    trackMedia,
    trackTitles,
    workspace.path,
    assetsDirectory,
    (filePath) => probeDuration(filePath, options.ffprobePath ?? "ffprobe"),
    speechRate,
    hostGap,
    hostVolume,
  );
  const graph = buildFilterGraph(segments, bgmSpans);

  const outputDirectory = path.join(workspace.path, OUTPUT_DIRECTORY);
  await mkdir(outputDirectory, { recursive: true });
  const nonce = `${process.pid}.${Date.now()}`;
  const filterGraphPath = path.join(outputDirectory, `.render.${nonce}.ffgraph`);
  const temporaryOutputPath = path.join(outputDirectory, `.program.${nonce}.tmp.mp3`);
  const outputPath = path.join(outputDirectory, OUTPUT_FILE);
  const temporarySubtitlePath = path.join(outputDirectory, `.program.${nonce}.tmp.srt`);
  const subtitlePath = path.join(outputDirectory, SUBTITLE_FILE);
  const manifestPath = path.join(outputDirectory, MANIFEST_FILE);
  const temporaryManifestPath = path.join(outputDirectory, `.manifest.${nonce}.tmp`);

  try {
    await writeFile(filterGraphPath, `${graph.filterGraph}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    const ffmpegArgs = [
      "-hide_banner",
      "-nostdin",
      "-y",
      ...graph.args,
      "-/filter_complex",
      filterGraphPath,
      "-map",
      "[program]",
      "-vn",
      "-c:a",
      "libmp3lame",
      "-b:a",
      BITRATE,
      "-ar",
      String(SAMPLE_RATE),
      "-ac",
      String(CHANNELS),
      "-metadata",
      `title=${workspace.name}`,
      temporaryOutputPath,
    ];
    const executeFfmpeg = options.executeFfmpeg ?? defaultExecuteFfmpeg;
    await executeFfmpeg(ffmpegArgs, options.ffmpegPath ?? "ffmpeg");
    await ensureMediaFile(temporaryOutputPath, "FFmpeg did not create a valid output file.");

    const durationSeconds = roundDuration(
      await probeDuration(temporaryOutputPath, options.ffprobePath ?? "ffprobe"),
    );
    const manifest = {
      version: 1,
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      filePath: OUTPUT_FILE,
      subtitlePath: SUBTITLE_FILE,
      durationSeconds,
      eventCount: events.length,
      inputCount: graph.inputCount,
      sampleRate: SAMPLE_RATE,
      channels: CHANNELS,
      codec: "libmp3lame",
      bitrate: BITRATE,
      loudness: { integrated: -16, range: 11, truePeak: -1.5 },
    } as const;
    await writeFile(temporaryManifestPath, `${JSON.stringify(manifest, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await writeFile(temporarySubtitlePath, formatSubRip(subtitleCues), {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(temporaryOutputPath, outputPath);
    await rename(temporarySubtitlePath, subtitlePath);
    await rename(temporaryManifestPath, manifestPath);

    return {
      workspace,
      path: outputPath,
      subtitles: subtitlePath,
      manifest: manifestPath,
      durationSeconds,
      eventCount: events.length,
      inputCount: graph.inputCount,
    };
  } finally {
    await Promise.all([
      rm(filterGraphPath, { force: true }),
      rm(temporaryOutputPath, { force: true }),
      rm(temporarySubtitlePath, { force: true }),
      rm(temporaryManifestPath, { force: true }),
    ]);
  }
}

async function buildTimeline(
  events: RadioEvent[],
  speechMedia: Map<string, string>,
  trackMedia: Map<string, string>,
  trackTitles: Map<string, string>,
  workspaceDirectory: string,
  assetsDirectory: string,
  probeDuration: (filePath: string) => Promise<number>,
  speechRate: number = 1.0,
  hostGap: number = DEFAULT_HOST_GAP,
  hostVolume: number = 1.0,
): Promise<{
  segments: TimelineSegment[];
  bgmSpans: BgmSpan[];
  subtitleCues: SubtitleCue[];
}> {
  const segments: TimelineSegment[] = [];
  const bgmSpans: BgmSpan[] = [];
  const subtitleCues: SubtitleCue[] = [];
  let duration = 0;
  let pendingCrossfade: number | undefined;
  let activeBgm: ActiveBgm | undefined;
  let lastAppendedWasHost = false;

  const appendSegment = (
    segment: TimelineSegment,
    subtitleText?: string,
  ): void => {
    let startAt = duration;
    if (pendingCrossfade !== undefined) {
      const previous = segments.at(-1);
      if (previous === undefined) {
        throw invalidDependency("A fade transition requires audio before it.");
      }
      const effectiveCrossfade = Math.min(pendingCrossfade, previous.duration, segment.duration);
      segment.crossfadeBefore = effectiveCrossfade;
      startAt -= effectiveCrossfade;
      duration += segment.duration - effectiveCrossfade;
      pendingCrossfade = undefined;
    } else {
      duration += segment.duration;
    }
    segments.push(segment);
    if (subtitleText !== undefined) {
      appendSubtitleCue(
        subtitleCues,
        startAt,
        startAt + segment.duration,
        subtitleText,
      );
    }
  };

  const closeBgm = (fadeOut?: number): void => {
    if (activeBgm === undefined) {
      throw invalidDependency("A BGM stop event has no active BGM.");
    }
    const spanDuration = duration - activeBgm.startAt;
    if (spanDuration <= 0) {
      throw invalidDependency(`Bed audio ${activeBgm.source} has no audible duration.`);
    }
    bgmSpans.push({
      ...activeBgm,
      duration: spanDuration,
      fadeOut: fadeOut ?? activeBgm.fadeOut,
    });
    activeBgm = undefined;
  };

  for (const event of events) {
    switch (event.type) {
      case "pause":
        appendSegment({ type: "silence", duration: event.duration });
        lastAppendedWasHost = false;
        break;
      case "crossfade":
        if (pendingCrossfade !== undefined || segments.length === 0) {
          throw invalidDependency(
            "A crossfade must be between two main timeline audio segments.",
          );
        }
        pendingCrossfade = event.duration;
        lastAppendedWasHost = false;
        break;
      case "audio": {
        if (event.role === "host") {
          if (lastAppendedWasHost && hostGap > 0 && pendingCrossfade === undefined) {
            appendSegment({ type: "silence", duration: hostGap });
          }
          const filePath = requiredMedia(speechMedia, event.id, "speech");
          assertWorkspaceSource(event.source, workspaceDirectory, filePath);
          const hostDuration = await probeValidDuration(filePath, probeDuration);
          appendSegment({
            type: "file",
            filePath,
            duration: hostDuration / speechRate,
            speechRate,
            volume: hostVolume !== 1.0 ? hostVolume : undefined,
          }, event.text);
          lastAppendedWasHost = true;
          if (activeBgm !== undefined && event.duckTo !== undefined) {
            activeBgm.ducks.push({
              startAt: duration - (hostDuration / speechRate) - activeBgm.startAt,
              duration: hostDuration / speechRate,
              volume: event.duckTo,
              fade: event.duckFade ?? 0,
            });
          }
          break;
        }
        if (event.role === "bed") {
          if (pendingCrossfade !== undefined) {
            throw invalidDependency(
              "Bed audio controls cannot split a crossfade.",
            );
          }
          if (event.action === "stop") {
            closeBgm();
            break;
          }
          if (activeBgm !== undefined) {
            throw invalidDependency(
              `Bed audio ${event.source} starts before ${activeBgm.source} stops.`,
            );
          }
          activeBgm = {
            source: event.source,
            filePath: await resolveEventSource(
              event.source,
              workspaceDirectory,
              assetsDirectory,
              trackMedia,
            ),
            startAt: duration,
            sourceStart: event.start ?? 0,
            volume: event.volume ?? 0.25,
            fadeIn: event.fadeIn ?? 0,
            fadeOut: event.fadeOut ?? 0,
            ducks: [],
          };
          break;
        }

        const isMain = event.role === "main";
        const filePath = isMain
          ? requiredTrackSource(event.source, trackMedia)
          : await resolveEventSource(
              event.source,
              workspaceDirectory,
              assetsDirectory,
              trackMedia,
            );
        const mediaDuration = await probeValidDuration(filePath, probeDuration);
        const start = event.start ?? 0;
        const segmentDuration = Math.min(
          event.duration ?? mediaDuration - start,
          mediaDuration - start,
        );
        if (start >= mediaDuration || segmentDuration <= 0) {
          throw invalidDependency(
            `Audio source ${event.source} has an invalid start or duration.`,
          );
        }
        appendSegment(compactSegment({
          type: "file" as const,
          filePath,
          start,
          duration: segmentDuration,
          volume: event.volume,
          fadeIn: event.fadeIn,
          fadeOut: event.fadeOut,
        }), isMain
          ? `播放《${requiredTrackTitle(event.source, trackTitles)}》中...`
          : undefined);
        lastAppendedWasHost = false;
        break;
      }
    }
  }

  if (pendingCrossfade !== undefined) {
    throw invalidDependency("A fade transition requires audio after it.");
  }
  if (segments.length === 0) {
    throw invalidDependency(`${EVENTS_FILE} contains no renderable audio events.`);
  }
  if (activeBgm !== undefined) {
    closeBgm();
  }

  return { segments, bgmSpans, subtitleCues };
}

function buildFilterGraph(
  segments: TimelineSegment[],
  bgmSpans: BgmSpan[],
): RenderGraph {
  const args: string[] = [];
  const filters: string[] = [];
  let inputIndex = 0;

  const segmentLabels = segments.map((segment, index) => {
    const label = `segment${index}`;
    if (segment.type === "silence") {
      filters.push(
        `anullsrc=r=${SAMPLE_RATE}:cl=stereo:d=${formatNumber(segment.duration)},` +
          `atrim=duration=${formatNumber(segment.duration)},asetpts=PTS-STARTPTS[${label}]`,
      );
      return label;
    }

    if (segment.loop) {
      args.push("-stream_loop", "-1");
    }
    args.push("-i", segment.filePath);
    const chain = [
      `[${inputIndex}:a]aresample=${SAMPLE_RATE}`,
      `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
      `atrim=start=${formatNumber(segment.start ?? 0)}:duration=${formatNumber(segment.duration * (segment.speechRate ?? 1))}`,
      "asetpts=PTS-STARTPTS",
    ];
    inputIndex += 1;
    if (segment.speechRate !== undefined && segment.speechRate !== 1) {
      chain.push(`atempo=${formatNumber(segment.speechRate)}`);
    }
    if (segment.volume !== undefined) {
      chain.push(`volume=${formatNumber(segment.volume)}`);
    }
    if (segment.fadeIn !== undefined && segment.fadeIn > 0) {
      chain.push(
        `afade=t=in:st=0:d=${formatNumber(Math.min(segment.fadeIn, segment.duration))}`,
      );
    }
    if (segment.fadeOut !== undefined && segment.fadeOut > 0) {
      const fadeDuration = Math.min(segment.fadeOut, segment.duration);
      chain.push(
        `afade=t=out:st=${formatNumber(segment.duration - fadeDuration)}:d=${formatNumber(fadeDuration)}`,
      );
    }
    filters.push(`${chain.join(",")}[${label}]`);
    return label;
  });

  let mainLabel = segmentLabels[0];
  for (let index = 1; index < segmentLabels.length; index += 1) {
    const outputLabel = `joined${index}`;
    const crossfade = segments[index].crossfadeBefore;
    if (crossfade !== undefined) {
      filters.push(
        `[${mainLabel}][${segmentLabels[index]}]` +
          `acrossfade=d=${formatNumber(crossfade)}:c1=tri:c2=tri,` +
          `asetpts=PTS-STARTPTS[${outputLabel}]`,
      );
    } else {
      filters.push(
        `[${mainLabel}][${segmentLabels[index]}]concat=n=2:v=0:a=1,` +
          `asetpts=PTS-STARTPTS[${outputLabel}]`,
      );
    }
    mainLabel = outputLabel;
  }

  const bgmLabels = bgmSpans.map((span, index) => {
    args.push("-stream_loop", "-1", "-i", span.filePath);
    const label = `bgm${index}`;
    const chain = [
      `[${inputIndex}:a]aresample=${SAMPLE_RATE}`,
      `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo`,
      `atrim=start=${formatNumber(span.sourceStart)}:duration=${formatNumber(span.duration)}`,
      "asetpts=PTS-STARTPTS",
      `volume=${formatNumber(span.volume)}`,
    ];
    inputIndex += 1;
    for (const duck of span.ducks) {
      chain.push(
        `volume='${buildDuckExpression(duck, span.volume)}':eval=frame`,
      );
    }
    if (span.fadeIn > 0) {
      chain.push(
        `afade=t=in:st=0:d=${formatNumber(Math.min(span.fadeIn, span.duration))}`,
      );
    }
    if (span.fadeOut > 0) {
      const fadeDuration = Math.min(span.fadeOut, span.duration);
      chain.push(
        `afade=t=out:st=${formatNumber(span.duration - fadeDuration)}:d=${formatNumber(fadeDuration)}`,
      );
    }
    if (span.startAt > 0) {
      chain.push(`adelay=delays=${Math.round(span.startAt * 1000)}:all=1`);
    }
    filters.push(`${chain.join(",")}[${label}]`);
    return label;
  });

  if (bgmLabels.length > 0) {
    const mixedLabel = "mixed";
    filters.push(
      `[${mainLabel}]${bgmLabels.map((label) => `[${label}]`).join("")}` +
        `amix=inputs=${bgmLabels.length + 1}:duration=first:` +
        `dropout_transition=0:normalize=0[${mixedLabel}]`,
    );
    mainLabel = mixedLabel;
  }

  filters.push(
    `[${mainLabel}]loudnorm=I=-16:LRA=11:TP=-1.5,` +
      `aresample=${SAMPLE_RATE},` +
      `aformat=sample_fmts=fltp:sample_rates=${SAMPLE_RATE}:channel_layouts=stereo[program]`,
  );

  return { args, filterGraph: filters.join(";\n"), inputCount: inputIndex };
}

function buildDuckExpression(duck: DuckSpan, bedVolume: number): string {
  const ratio = bedVolume <= 0
    ? 0
    : Math.min(duck.volume, bedVolume) / bedVolume;
  const start = Math.max(0, duck.startAt);
  const end = start + duck.duration;
  const fade = Math.min(duck.fade, duck.duration / 2);
  if (fade <= 0) {
    return `if(between(t,${formatNumber(start)},${formatNumber(end)}),${formatNumber(ratio)},1)`;
  }
  const fadeInStart = Math.max(0, start - fade);
  const fadeOutEnd = end + fade;
  if (fadeInStart === start) {
    return (
      `if(lt(t,${formatNumber(end)}),${formatNumber(ratio)},` +
      `if(lt(t,${formatNumber(fadeOutEnd)}),${formatNumber(ratio)}+(1-${formatNumber(ratio)})*(t-${formatNumber(end)})/${formatNumber(fade)},1))`
    );
  }
  return (
    `if(lt(t,${formatNumber(fadeInStart)}),1,` +
    `if(lt(t,${formatNumber(start)}),1+(${formatNumber(ratio)}-1)*(t-${formatNumber(fadeInStart)})/${formatNumber(fade)},` +
    `if(lt(t,${formatNumber(end)}),${formatNumber(ratio)},` +
    `if(lt(t,${formatNumber(fadeOutEnd)}),${formatNumber(ratio)}+(1-${formatNumber(ratio)})*(t-${formatNumber(end)})/${formatNumber(fade)},1))))`
  );
}

function parseStoredEvents(eventsText: string): RadioEvent[] {
  let parsed: unknown;
  try {
    parsed = JSON.parse(eventsText);
  } catch (error) {
    throw invalidDependency(`${EVENTS_FILE} is not valid JSON.`, error);
  }
  if (!Array.isArray(parsed) || parsed.length === 0) {
    throw invalidDependency(`${EVENTS_FILE} must contain a non-empty event array.`);
  }

  const hostIds = new Set<string>();
  for (const [index, value] of parsed.entries()) {
    const event = asObject(value);
    if (event === undefined || typeof event.type !== "string" || !EVENT_TYPES.has(event.type)) {
      throw invalidEvent(index, "has an invalid type");
    }
    validateEvent(event, event.type, index, hostIds);
  }
  return parsed as RadioEvent[];
}

function validateEvent(
  event: Record<string, unknown>,
  type: string,
  index: number,
  hostIds: Set<string>,
): void {
  switch (type) {
    case "pause":
      validateNumber(event.duration, index, "duration", 0, false);
      return;
    case "crossfade":
      validateNumber(event.duration, index, "duration", 0, false);
      return;
    case "audio": {
      const role = event.role;
      if (role !== "host" && role !== "main" && role !== "bed" && role !== "effect") {
        throw invalidEvent(index, "requires a valid audio role");
      }
      if (role === "host") {
        const id = nonEmptyString(event.id);
        if (id === undefined || !/^host-\d{3,}$/u.test(id)) {
          throw invalidEvent(index, "requires an id such as host-001");
        }
        if (hostIds.has(id)) {
          throw invalidEvent(index, `duplicates host id ${id}`);
        }
        hostIds.add(id);
        if (
          nonEmptyString(event.source) === undefined ||
          nonEmptyString(event.text) === undefined ||
          nonEmptyString(event.voiceDesignPrompt) === undefined
        ) {
          throw invalidEvent(index, "requires source, text and voiceDesignPrompt");
        }
        validateOptionalNumber(event.duckTo, index, "duckTo", 0, 1);
        validateOptionalNumber(event.duckFade, index, "duckFade", 0);
        return;
      }
      if (role === "bed") {
        if (event.action !== "start" && event.action !== "stop") {
          throw invalidEvent(index, "requires a bed action");
        }
        if (event.action === "start" && nonEmptyString(event.source) === undefined) {
          throw invalidEvent(index, "requires a bed source");
        }
      } else if (nonEmptyString(event.source) === undefined) {
        throw invalidEvent(index, "requires an audio source");
      }
      validateOptionalNumber(event.start, index, "start", 0);
      validateOptionalNumber(event.duration, index, "duration", 0);
      validateOptionalNumber(event.volume, index, "volume", 0, 1);
      validateOptionalNumber(event.fadeIn, index, "fadeIn", 0);
      validateOptionalNumber(event.fadeOut, index, "fadeOut", 0);
      return;
    }
  }
}

async function readTrackTitles(
  playlistPath: string,
  requiredIds: Set<string>,
): Promise<Map<string, string>> {
  const text = await readRequiredFile(
    playlistPath,
    `Required render dependency ${PLAYLIST_FILE} does not exist.`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw invalidDependency(`${PLAYLIST_FILE} is not valid JSON.`, error);
  }
  const tracks = asObject(asObject(parsed)?.playlist)?.tracks;
  if (!Array.isArray(tracks) || tracks.length === 0) {
    throw invalidDependency(
      `${PLAYLIST_FILE} must contain a non-empty playlist.tracks array.`,
    );
  }

  const titles = new Map<string, string>();
  for (const [index, value] of tracks.entries()) {
    const track = asObject(value);
    const rawId = track?.id;
    const id = typeof rawId === "string" && /^\d+$/u.test(rawId)
      ? rawId
      : typeof rawId === "number" && Number.isSafeInteger(rawId) && rawId >= 0
        ? String(rawId)
        : undefined;
    if (id === undefined || !requiredIds.has(id)) {
      continue;
    }
    if (titles.has(id)) {
      throw invalidDependency(`${PLAYLIST_FILE} duplicates track id ${id}.`);
    }
    const title = nonEmptyString(track?.name);
    if (title === undefined) {
      throw invalidDependency(
        `${PLAYLIST_FILE} has an invalid title for track ${id} at index ${index}.`,
      );
    }
    titles.set(id, title);
  }

  for (const id of requiredIds) {
    if (!titles.has(id)) {
      throw invalidDependency(
        `${PLAYLIST_FILE} does not contain a title for track ${id}.`,
      );
    }
  }
  return titles;
}

async function readMediaManifest(
  directory: string,
  collectionName: "segments" | "tracks",
  requiredIds: Set<string>,
  completeStatus: string,
  dependencyName: string,
): Promise<Map<string, string>> {
  const manifestPath = path.join(directory, "manifest.json");
  const text = await readRequiredFile(
    manifestPath,
    `Required render dependency ${dependencyName}/manifest.json does not exist.`,
  );
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (error) {
    throw invalidDependency(`${dependencyName}/manifest.json is not valid JSON.`, error);
  }
  const root = asObject(parsed);
  const entries = root?.[collectionName];
  if (!Array.isArray(entries)) {
    throw invalidDependency(
      `${dependencyName}/manifest.json must contain a ${collectionName} array.`,
    );
  }

  const media = new Map<string, string>();
  for (const [index, value] of entries.entries()) {
    const entry = asObject(value);
    const rawId = entry?.id;
    const id = typeof rawId === "string" || typeof rawId === "number"
      ? String(rawId)
      : undefined;
    const status = nonEmptyString(entry?.status);
    const filePath = nonEmptyString(entry?.filePath);
    if (id === undefined || status === undefined || filePath === undefined) {
      throw invalidDependency(
        `${dependencyName}/manifest.json has an invalid entry at index ${index}.`,
      );
    }
    if (!requiredIds.has(id)) {
      continue;
    }
    if (media.has(id)) {
      throw invalidDependency(
        `${dependencyName}/manifest.json duplicates media id ${id}.`,
      );
    }
    if (status !== completeStatus) {
      const hint = status === "failed"
        ? ` Run generate audio again to retry.`
        : "";
      throw invalidDependency(
        `${dependencyName} media ${id} is incomplete with status ${status}.${hint}`,
      );
    }
    const resolvedPath = path.resolve(directory, filePath);
    if (!isInside(directory, resolvedPath)) {
      throw invalidDependency(
        `${dependencyName} media ${id} has an unsafe filePath.`,
      );
    }
    await ensureMediaFile(
      resolvedPath,
      `${dependencyName} media ${id} does not exist or is empty.`,
    );
    media.set(id, resolvedPath);
  }

  for (const id of requiredIds) {
    if (!media.has(id)) {
      throw invalidDependency(
        `${dependencyName}/manifest.json does not contain complete media ${id}.`,
      );
    }
  }
  return media;
}

function trackIdFromSource(source: string): string | undefined {
  return /^\/audio\/(\d+)\.wav$/u.exec(source)?.[1];
}

function requiredTrackSource(
  source: string,
  trackMedia: Map<string, string>,
): string {
  const id = trackIdFromSource(source);
  if (id === undefined) {
    throw invalidDependency(
      `Main audio source ${source} must use /audio/<id>.wav.`,
    );
  }
  return requiredMedia(trackMedia, id, "audio");
}

function requiredTrackTitle(
  source: string,
  trackTitles: Map<string, string>,
): string {
  const id = trackIdFromSource(source);
  if (id === undefined) {
    throw invalidDependency(
      `Main audio source ${source} must use /audio/<id>.wav.`,
    );
  }
  const title = trackTitles.get(id);
  if (title === undefined) {
    throw invalidDependency(`${PLAYLIST_FILE} does not contain a title for track ${id}.`);
  }
  return title;
}

function stripVoiceTags(text: string): string {
  return text
    .replace(/\([^)]*\)/gu, "")
    .replace(/（[^）]*）/gu, "")
    .replace(/\[[^\]]*\]/gu, "")
    .replace(/\s{2,}/gu, " ")
    .trim();
}

function appendSubtitleCue(
  cues: SubtitleCue[],
  start: number,
  end: number,
  text: string,
): void {
  const previous = cues.at(-1);
  if (previous !== undefined && previous.end > start) {
    previous.end = start;
    if (previous.end <= previous.start) {
      cues.pop();
    }
  }
  if (end <= start) {
    return;
  }
  const cleanText = stripVoiceTags(text);
  if (!cleanText) {
    return;
  }
  cues.push({
    start,
    end,
    text: cleanText.replace(/\r\n?/gu, "\n").replace(/\n{2,}/gu, "\n"),
  });
}

function formatSubRip(cues: SubtitleCue[]): string {
  return cues
    .map(
      (cue, index) =>
        `${index + 1}\n${formatSubtitleTime(cue.start)} --> ${formatSubtitleTime(cue.end)}\n${cue.text}\n`,
    )
    .join("\n");
}

function formatSubtitleTime(seconds: number): string {
  const totalMilliseconds = Math.max(0, Math.round(seconds * 1000));
  const milliseconds = totalMilliseconds % 1000;
  const totalSeconds = Math.floor(totalMilliseconds / 1000);
  const second = totalSeconds % 60;
  const totalMinutes = Math.floor(totalSeconds / 60);
  const minute = totalMinutes % 60;
  const hour = Math.floor(totalMinutes / 60);
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}:${String(second).padStart(2, "0")},${String(milliseconds).padStart(3, "0")}`;
}

async function resolveEventSource(
  source: string,
  workspaceDirectory: string,
  assetsDirectory: string,
  trackMedia: Map<string, string>,
): Promise<string> {
  const trackId = trackIdFromSource(source);
  if (trackId !== undefined) {
    return requiredMedia(trackMedia, trackId, "audio");
  }
  if (source.startsWith("bgm/")) {
    return resolveAsset(assetsDirectory, "bgm", source.slice(4));
  }
  if (source.startsWith("sfx/")) {
    return resolveAsset(assetsDirectory, "sfx", source.slice(4));
  }
  if (!source.startsWith("/")) {
    throw invalidDependency(`Audio source ${source} is unsupported.`);
  }
  const filePath = path.resolve(workspaceDirectory, source.slice(1));
  if (!isInside(workspaceDirectory, filePath)) {
    throw invalidDependency(`Audio source ${source} is unsafe.`);
  }
  await ensureMediaFile(filePath, `Audio source ${source} does not exist or is empty.`);
  return filePath;
}

function assertWorkspaceSource(
  source: string,
  workspaceDirectory: string,
  expectedPath: string,
): void {
  if (!source.startsWith("/")) {
    throw invalidDependency(`Host audio source ${source} must be workspace-relative.`);
  }
  const resolved = path.resolve(workspaceDirectory, source.slice(1));
  if (!isInside(workspaceDirectory, resolved) || resolved !== expectedPath) {
    throw invalidDependency(
      `Host audio source ${source} does not match speech manifest media.`,
    );
  }
}

function compactSegment(value: FileSegment): FileSegment {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as unknown as FileSegment;
}

async function resolveAsset(
  assetsDirectory: string,
  category: "bgm" | "sfx",
  name: string,
): Promise<string> {
  if (path.isAbsolute(name) || path.basename(name) !== name || name === "." || name === "..") {
    throw invalidDependency(`Asset name ${name} is unsafe.`);
  }
  const categoryDirectory = path.join(assetsDirectory, category);
  const candidates = path.extname(name).length > 0
    ? [name]
    : ASSET_EXTENSIONS.map((extension) => `${name}${extension}`);
  for (const candidate of candidates) {
    const filePath = path.join(categoryDirectory, candidate);
    try {
      await ensureMediaFile(filePath, "");
      return filePath;
    } catch (error) {
      if (!(error instanceof ProgramRenderError)) {
        throw error;
      }
    }
  }
  throw new ProgramRenderError(
    "MISSING_RENDER_DEPENDENCY",
    `Required ${category.toUpperCase()} asset ${name} was not found in ${categoryDirectory}.`,
  );
}

async function readRequiredFile(filePath: string, missingMessage: string): Promise<string> {
  try {
    return await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ProgramRenderError("MISSING_RENDER_DEPENDENCY", missingMessage);
    }
    throw error;
  }
}

async function ensureMediaFile(filePath: string, message: string): Promise<void> {
  try {
    const fileStat = await stat(filePath);
    if (!fileStat.isFile() || fileStat.size === 0) {
      throw invalidDependency(message || `Media file ${filePath} is invalid.`);
    }
  } catch (error) {
    if (error instanceof ProgramRenderError) {
      throw error;
    }
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new ProgramRenderError(
        "MISSING_RENDER_DEPENDENCY",
        message || `Media file ${filePath} does not exist.`,
      );
    }
    throw error;
  }
}

async function probeValidDuration(
  filePath: string,
  probeDuration: (filePath: string) => Promise<number>,
): Promise<number> {
  try {
    const duration = await probeDuration(filePath);
    if (!Number.isFinite(duration) || duration <= 0) {
      throw new Error(`Invalid duration ${duration}`);
    }
    return duration;
  } catch (error) {
    if (error instanceof ProgramRenderError) {
      throw error;
    }
    throw invalidDependency(
      `Unable to read audio duration for ${path.basename(filePath)}: ${getErrorMessage(error)}`,
      error,
    );
  }
}

async function defaultExecuteFfmpeg(
  args: string[],
  executable = "ffmpeg",
): Promise<void> {
  const result = await runProcess(executable, args);
  if (result.code !== 0) {
    throw new ProgramRenderError(
      "RENDER_FAILED",
      `FFmpeg exited with code ${result.code}. ${lastLines(result.stderr)}`.trim(),
    );
  }
}

async function defaultProbeDuration(
  filePath: string,
  executable = "ffprobe",
): Promise<number> {
  const result = await runProcess(executable, [
    "-v",
    "error",
    "-show_entries",
    "format=duration",
    "-of",
    "default=noprint_wrappers=1:nokey=1",
    filePath,
  ]);
  if (result.code !== 0) {
    throw new ProgramRenderError(
      "RENDER_FAILED",
      `ffprobe failed for ${path.basename(filePath)}. ${lastLines(result.stderr)}`.trim(),
    );
  }
  return Number(result.stdout.trim());
}

async function runProcess(
  executable: string,
  args: string[],
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve, reject) => {
    const child = spawn(executable, args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk: string) => {
      stdout = appendBounded(stdout, chunk);
    });
    child.stderr.on("data", (chunk: string) => {
      stderr = appendBounded(stderr, chunk);
    });
    child.once("error", (error) => {
      if (isNodeError(error) && error.code === "ENOENT") {
        reject(
          new ProgramRenderError(
            "FFMPEG_NOT_FOUND",
            `Required executable ${executable} was not found.`,
            { cause: error },
          ),
        );
        return;
      }
      reject(error);
    });
    child.once("close", (code) => {
      resolve({ code: code ?? -1, stdout, stderr });
    });
  });
}

function requiredMedia(
  media: Map<string, string>,
  id: string,
  dependencyName: string,
): string {
  const filePath = media.get(id);
  if (filePath === undefined) {
    throw invalidDependency(`Missing complete ${dependencyName} media ${id}.`);
  }
  return filePath;
}

function validateOptionalNumber(
  value: unknown,
  index: number,
  field: string,
  minimum: number,
  maximum = Number.POSITIVE_INFINITY,
): void {
  if (value !== undefined) {
    validateNumber(value, index, field, minimum, true, maximum);
  }
}

function validateNumber(
  value: unknown,
  index: number,
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
    throw invalidEvent(index, `has an invalid ${field}`);
  }
}

function invalidEvent(index: number, detail: string): ProgramRenderError {
  return invalidDependency(`${EVENTS_FILE} event at index ${index} ${detail}.`);
}

function invalidDependency(message: string, cause?: unknown): ProgramRenderError {
  return new ProgramRenderError(
    "INVALID_RENDER_DEPENDENCY",
    message,
    cause === undefined ? undefined : { cause },
  );
}

function asObject(value: unknown): Record<string, unknown> | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function nonEmptyString(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : undefined;
}

function isInside(directory: string, filePath: string): boolean {
  const relative = path.relative(path.resolve(directory), filePath);
  return relative.length > 0 && !relative.startsWith("..") && !path.isAbsolute(relative);
}

function formatNumber(value: number): string {
  return Number(value.toFixed(6)).toString();
}

function roundDuration(value: number): number {
  return Number(value.toFixed(3));
}

function appendBounded(current: string, chunk: string): string {
  const combined = current + chunk;
  return combined.length <= 65_536 ? combined : combined.slice(-65_536);
}

function lastLines(value: string): string {
  return value.trim().split("\n").slice(-12).join("\n");
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
