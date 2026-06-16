import { createInterface } from "node:readline/promises";

import {
  generateAudio,
  type AudioDownloadResult,
  type GenerateAudioOptions,
} from "../core/audio.js";
import { fetchAndSaveCookie } from "../core/cookie.js";
import {
  generateProgramEvents,
  type ProgramEventsResult,
} from "../core/events.js";
import {
  createWorkspace,
  deleteWorkspace,
  getWorkspacePath,
  getWorkspaceShowDetail,
  getWorkspaceStatus,
  listWorkspaces,
  readWorkspaceInfo,
} from "../core/workspaces.js";
import {
  importNeteasePlaylist,
  searchNeteasePlaylist,
  type PlaylistImportResult,
} from "../core/playlists.js";
import {
  generateProgramPlan,
  type ProgramPlanResult,
} from "../core/plans.js";
import {
  generateProgramRender,
  type ProgramRenderResult,
} from "../core/render.js";
import {
  generateDetail,
  type DetailResult,
} from "../core/detail.js";
import {
  generateProgramScript,
  type ProgramScriptResult,
} from "../core/scripts.js";
import {
  generateSpeech,
  type SpeechGenerationResult,
  type GenerateSpeechOptions,
} from "../core/speech.js";
import type { TtsVoice } from "../core/tts.js";
import {
  testNeteaseCookie,
  testAiConfig,
  type CookieTestResult,
  type AiTestResult,
} from "../core/test.js";
import {
  generateProgramWorkflow,
  type GenerateWorkflowOptions,
  type WorkflowResult,
} from "../core/workflow.js";
import { CliUsageError, toCliFailure, writeJson } from "./output.js";
import {
  createWorkflowProgressReporter,
  runWithBlockingNotice,
} from "./progress.js";

interface CliDependencies {
  testNeteaseCookie?: (
    baseDirectory: string,
  ) => Promise<CookieTestResult>;
  testAiConfig?: (
    baseDirectory: string,
  ) => Promise<AiTestResult>;
  importPlaylist?: (
    workspaceName: string,
    playlistUrl: string,
    baseDirectory: string,
  ) => Promise<PlaylistImportResult>;
  searchPlaylist?: (
    query: string,
    baseDirectory: string,
  ) => Promise<string>;
  generatePlan?: (
    workspaceName: string,
    count: number,
    baseDirectory: string,
  ) => Promise<ProgramPlanResult>;
  generateDetail?: (
    workspaceName: string,
    baseDirectory: string,
    options: { limit?: number },
  ) => Promise<DetailResult>;
  generateScript?: (
    workspaceName: string,
    baseDirectory: string,
  ) => Promise<ProgramScriptResult>;
  generateEvents?: (
    workspaceName: string,
    baseDirectory: string,
  ) => Promise<ProgramEventsResult>;
  generateAudio?: (
    workspaceName: string,
    baseDirectory: string,
    options: GenerateAudioOptions,
  ) => Promise<AudioDownloadResult>;
  generateSpeech?: (
    workspaceName: string,
    baseDirectory: string,
    options: GenerateSpeechOptions,
  ) => Promise<SpeechGenerationResult>;
  generateRender?: (
    workspaceName: string,
    baseDirectory: string,
  ) => Promise<ProgramRenderResult>;
  generateAll?: (
    workspaceName: string,
    baseDirectory: string,
    options: GenerateWorkflowOptions,
  ) => Promise<WorkflowResult>;
}

export async function runCli(
  args: string[],
  baseDirectory = process.cwd(),
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const [command, ...commandArgs] = args;

    if (command === "create") {
      const { name, prompt, playlistUrl, playlistQuery } =
        parseCreateArgs(commandArgs);
      const created = await createWorkspace(name, prompt, baseDirectory);

      let playlistResult: PlaylistImportResult | undefined;
      if (playlistUrl || playlistQuery) {
        try {
          const importPlaylist =
            dependencies.importPlaylist ?? importNeteasePlaylist;
          let resolvedUrl = playlistUrl;
          if (playlistQuery) {
            const searchPlaylist =
              dependencies.searchPlaylist ?? searchNeteasePlaylist;
            const searchResult = await searchPlaylist(
              playlistQuery,
              baseDirectory,
            );
            resolvedUrl = `https://music.163.com/playlist?id=${searchResult.playlistId}`;
          }
          playlistResult = await importPlaylist(name, resolvedUrl!, baseDirectory);
        } catch (error) {
          await deleteWorkspace(name, baseDirectory);
          throw error;
        }
      }

      const info = playlistResult
        ? await readWorkspaceInfo(name, baseDirectory)
        : created.info;

      writeJson({
        success: true,
        data: {
          action: "create",
          workspace: { name: created.name, path: created.path },
          info,
          ...(playlistResult && {
            playlist: {
              id: playlistResult.playlistId,
              name: playlistResult.playlistName,
              trackCount: playlistResult.trackCount,
              path: playlistResult.path,
            },
          }),
        },
      });
      return 0;
    }

    if (command === "delete") {
      const { name, force } = parseDeleteArgs(commandArgs);

      if (!force && !(await confirmDeletion(name))) {
        writeJson({
          success: true,
          data: {
            action: "delete",
            workspace: {
              name,
              path: getWorkspacePath(name, baseDirectory),
            },
            deleted: false,
          },
        });
        return 0;
      }

      const workspace = await deleteWorkspace(name, baseDirectory);
      writeJson({
        success: true,
        data: { action: "delete", workspace, deleted: true },
      });
      return 0;
    }

    if (command === "generate") {
      if (commandArgs[0] === "all") {
        const { name, count, commentLimit, quality, voice, force, hostVolume, hostGap } =
          parseGenerateAllArgs(commandArgs);
        const generateAll =
          dependencies.generateAll ?? generateProgramWorkflow;
        const result = await generateAll(name, baseDirectory, {
          count,
          commentLimit,
          quality,
          voice,
          force,
          hostVolume,
          hostGap,
          onProgress: createWorkflowProgressReporter(),
        });
        writeJson({
          success: true,
          data: {
            action: "generate-all",
            workspace: result.workspace,
            stages: result.stages,
            render: {
              path: result.output,
              manifest: result.manifest,
            },
          },
        });
        return 0;
      }

      if (commandArgs[0] === "plan") {
        const { name, count } = parseGeneratePlanArgs(commandArgs);
        const { getDefaultTrackCount } = await import("../core/workflow.js");
        const finalCount = count ?? getDefaultTrackCount();
        const generatePlan = dependencies.generatePlan ?? generateProgramPlan;
        const result = await runWithBlockingNotice(
          "AI 正在生成节目策划，请稍候...",
          () => generatePlan(name, finalCount, baseDirectory),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-plan",
            workspace: result.workspace,
            plan: {
              path: result.path,
              trackCount: result.trackCount,
              think: result.think,
            },
          },
        });
        return 0;
      }

      if (commandArgs[0] === "detail") {
        const { name, limit } = parseGenerateDetailArgs(commandArgs);
        const generateDetailFn = dependencies.generateDetail ?? generateDetail;
        const result = await runWithBlockingNotice(
          "正在搜索歌词和评论，请稍候...",
          () => generateDetailFn(name, baseDirectory, { limit }),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-detail",
            workspace: result.workspace,
            detail: {
              trackCount: result.trackCount,
              lyricsCount: result.lyricsCount,
              commentsCount: result.commentsCount,
            },
          },
        });
        return 0;
      }

      if (commandArgs[0] === "script") {
        const { name } = parseGenerateScriptArgs(commandArgs);
        const generateScript =
          dependencies.generateScript ?? generateProgramScript;
        const result = await runWithBlockingNotice(
          "AI 正在生成节目文稿，请稍候...",
          () => generateScript(name, baseDirectory),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-script",
            workspace: result.workspace,
            script: {
              path: result.path,
              trackCount: result.trackCount,
              theme: result.theme,
              format: result.format,
            },
          },
        });
        return 0;
      }

      if (commandArgs[0] === "events") {
        const { name } = parseGenerateEventsArgs(commandArgs);
        const generateEvents =
          dependencies.generateEvents ?? generateProgramEvents;
        const result = await generateEvents(name, baseDirectory);
        writeJson({
          success: true,
          data: {
            action: "generate-events",
            workspace: result.workspace,
            events: {
              path: result.path,
              eventCount: result.eventCount,
              hostCount: result.hostCount,
              playCount: result.playCount,
            },
          },
        });
        return 0;
      }

      if (commandArgs[0] === "audio") {
        const { name, quality, force } = parseGenerateAudioArgs(commandArgs);
        const generateAudioFn = dependencies.generateAudio ?? generateAudio;
        const result = await runWithBlockingNotice(
          "正在下载音频，请稍候...",
          () => generateAudioFn(name, baseDirectory, { quality, force }),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-audio",
            workspace: result.workspace,
            audio: {
              directory: result.directory,
              manifest: result.manifest,
              trackCount: result.trackCount,
              downloadedCount: result.downloadedCount,
              placeholderCount: result.placeholderCount,
            },
            warnings: result.warnings,
          },
        });
        return 0;
      }

      if (commandArgs[0] === "speech") {
        const { name, voice, force } = parseGenerateSpeechArgs(commandArgs);
        const generateSpeechFn = dependencies.generateSpeech ?? generateSpeech;
        const result = await runWithBlockingNotice(
          "正在将文稿转换为语音，请稍候...",
          () => generateSpeechFn(name, baseDirectory, { voice, force }),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-speech",
            workspace: result.workspace,
            speech: {
              directory: result.directory,
              manifest: result.manifest,
              segmentCount: result.segmentCount,
              synthesizedCount: result.synthesizedCount,
              placeholderCount: result.placeholderCount,
            },
            warnings: result.warnings,
          },
        });
        return 0;
      }

      if (commandArgs[0] === "render") {
        const { name, hostVolume, hostGap } = parseGenerateRenderArgs(commandArgs);
        const generateRender =
          dependencies.generateRender ?? generateProgramRender;
        const result = await runWithBlockingNotice(
          "正在合成节目，请稍候...",
          () => generateRender(name, baseDirectory, { hostVolume, hostGap }),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-render",
            workspace: result.workspace,
            render: {
              path: result.path,
              subtitles: result.subtitles,
              manifest: result.manifest,
              durationSeconds: result.durationSeconds,
              eventCount: result.eventCount,
              inputCount: result.inputCount,
            },
          },
        });
        return 0;
      }

      throw new CliUsageError(
        "Usage: vibefm generate all <name> [--count <number>] [--commentLimit <number>] [--quality <level>] [--voice <voice>] [--force] | vibefm generate plan <name> --count <number> | vibefm generate detail <name> [--limit <number>] | vibefm generate script <name> | vibefm generate events <name> | vibefm generate audio <name> [--quality <level>] [--force] | vibefm generate speech <name> [--voice <voice>] [--force] | vibefm generate render <name>",
      );
    }

    if (command === "show") {
      const parsed = parseShowArgs(commandArgs);

      if (parsed.mode === "list") {
        const items = await listWorkspaces(baseDirectory);
        writeJson({
          success: true,
          data: { action: "show-list", items },
        });
        return 0;
      }

      const detail = await getWorkspaceShowDetail(parsed.name, baseDirectory);
      writeJson({
        success: true,
        data: { action: "show", ...detail },
      });
      return 0;
    }

    if (command === "status") {
      const { name } = parseStatusArgs(commandArgs);
      const result = await getWorkspaceStatus(name, baseDirectory);
      writeJson({
        success: true,
        data: {
          action: "status",
          workspace: result.workspace,
          stages: result.stages,
        },
      });
      return 0;
    }

    if (command === "cookie") {
      const result = await fetchAndSaveCookie(baseDirectory);
      writeJson({
        success: true,
        data: {
          action: "cookie",
          cookiePath: result.cookiePath,
          cookieCount: result.cookieCount,
        },
      });
      return 0;
    }

    if (command === "test") {
      const testCookie =
        dependencies.testNeteaseCookie ?? testNeteaseCookie;
      const testAi = dependencies.testAiConfig ?? testAiConfig;

      const errors: string[] = [];
      let cookieResult: CookieTestResult | null = null;
      let aiResult: AiTestResult | null = null;

      try {
        cookieResult = await runWithBlockingNotice(
          "正在检测网易云 cookie...",
          () => testCookie(baseDirectory),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push(message);
      }

      try {
        aiResult = await runWithBlockingNotice(
          "正在检测 AI 模型配置...",
          () => testAi(baseDirectory),
        );
      } catch (error) {
        const message =
          error instanceof Error ? error.message : String(error);
        errors.push(message);
      }

      const msg = formatTestMessage(cookieResult, aiResult, errors);

      writeJson({
        success: true,
        data: {
          action: "test",
          cookie: cookieResult,
          ai: aiResult,
          errors,
          msg,
        },
      });
      return errors.length === 0 ? 0 : 1;
    }

    throw new CliUsageError(
      "Usage: vibefm create <name> [prompt] [--playlist-url <url>] [--playlist-query <query>] | vibefm delete <name> [--force] | vibefm show list | vibefm show <name> | vibefm status <name> | vibefm cookie | vibefm test | vibefm generate all <name> [--count <number>] [--commentLimit <number>] [--quality <level>] [--voice <voice>] [--force] | vibefm generate plan <name> --count <number> | vibefm generate detail <name> [--limit <number>] | vibefm generate script <name> | vibefm generate events <name> | vibefm generate audio <name> [--quality <level>] [--force] | vibefm generate speech <name> [--voice <voice>] [--force] | vibefm generate render <name>",
    );
  } catch (error) {
    writeJson(toCliFailure(error));
    return 1;
  }
}

function parseGenerateAllArgs(args: string[]): {
  name: string;
  count?: number;
  commentLimit?: number;
  quality?: string;
  voice?: TtsVoice;
  force: boolean;
  hostVolume?: number;
  hostGap?: number;
} {
  const usage =
    "Usage: vibefm generate all <name> [--count <number>] [--commentLimit <number>] [--quality <level>] [--voice <voice>] [--force] [--host-volume <number>] [--host-gap <seconds>]";
  if (args[0] !== "all") {
    throw new CliUsageError(usage);
  }

  let name: string | undefined;
  let count: number | undefined;
  let commentLimit: number | undefined;
  let quality: string | undefined;
  let voice: TtsVoice | undefined;
  let force = false;
  let hostVolume: number | undefined;
  let hostGap: number | undefined;

  const rest = args.slice(1);
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument === "--count") {
      const value = rest[++index];
      if (value === undefined || !/^\d+$/u.test(value)) {
        throw new CliUsageError(usage);
      }
      count = Number(value);
      if (!Number.isSafeInteger(count) || count <= 0) {
        throw new CliUsageError(usage);
      }
      continue;
    }
    if (argument === "--commentLimit") {
      const value = rest[++index];
      if (value === undefined || !/^\d+$/u.test(value)) {
        throw new CliUsageError(usage);
      }
      commentLimit = Number(value);
      if (!Number.isSafeInteger(commentLimit) || commentLimit <= 0) {
        throw new CliUsageError(usage);
      }
      continue;
    }
    if (argument === "--quality") {
      const value = rest[++index];
      if (
        value === undefined ||
        !(VALID_QUALITY_LEVELS as readonly string[]).includes(value)
      ) {
        throw new CliUsageError(
          `Invalid quality level. Must be one of: ${VALID_QUALITY_LEVELS.join(", ")}`,
        );
      }
      quality = value;
      continue;
    }
    if (argument === "--voice") {
      const value = rest[++index];
      if (
        value === undefined ||
        !(VALID_TTS_VOICES as readonly string[]).includes(value)
      ) {
        throw new CliUsageError(
          `Invalid voice. Must be one of: ${VALID_TTS_VOICES.join(", ")}`,
        );
      }
      voice = value as TtsVoice;
      continue;
    }
    if (argument === "--host-volume") {
      const value = rest[++index];
      if (value === undefined || !/^\d+(\.\d+)?$/u.test(value)) {
        throw new CliUsageError(usage);
      }
      hostVolume = Number(value);
      continue;
    }
    if (argument === "--host-gap") {
      const value = rest[++index];
      if (value === undefined || !/^\d+(\.\d+)?$/u.test(value)) {
        throw new CliUsageError(usage);
      }
      hostGap = Number(value);
      continue;
    }
    if (argument.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }
    if (name !== undefined) {
      throw new CliUsageError(usage);
    }
    name = argument;
  }

  if (name === undefined) {
    throw new CliUsageError(usage);
  }

  return { name, count, commentLimit, quality, voice, force, hostVolume, hostGap };
}

function parseGenerateScriptArgs(args: string[]): { name: string } {
  if (args.length !== 2 || args[0] !== "script") {
    throw new CliUsageError("Usage: vibefm generate script <name>");
  }
  return { name: args[1] };
}

function parseGenerateEventsArgs(args: string[]): { name: string } {
  if (args.length !== 2 || args[0] !== "events") {
    throw new CliUsageError("Usage: vibefm generate events <name>");
  }
  return { name: args[1] };
}

function parseGenerateRenderArgs(args: string[]): { name: string; hostVolume?: number; hostGap?: number } {
  const usage = "Usage: vibefm generate render <name> [--host-volume <number>] [--host-gap <seconds>]";
  if (args[0] !== "render") {
    throw new CliUsageError(usage);
  }

  let name: string | undefined;
  let hostVolume: number | undefined;
  let hostGap: number | undefined;

  const rest = args.slice(1);
  for (let index = 0; index < rest.length; index++) {
    const argument = rest[index];
    if (argument === "--host-volume") {
      const value = rest[++index];
      if (value === undefined || !/^\d+(\.\d+)?$/u.test(value)) {
        throw new CliUsageError(usage);
      }
      hostVolume = Number(value);
      continue;
    }
    if (argument === "--host-gap") {
      const value = rest[++index];
      if (value === undefined || !/^\d+(\.\d+)?$/u.test(value)) {
        throw new CliUsageError(usage);
      }
      hostGap = Number(value);
      continue;
    }
    if (argument.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }
    if (name !== undefined) {
      throw new CliUsageError(usage);
    }
    name = argument;
  }

  if (name === undefined) {
    throw new CliUsageError(usage);
  }

  return { name, hostVolume, hostGap };
}

const VALID_QUALITY_LEVELS = [
  "standard",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "jymaster",
  "sky",
  "immersive",
] as const;

function parseGenerateAudioArgs(args: string[]): {
  name: string;
  quality: string;
  force: boolean;
} {
  if (args[0] !== "audio") {
    throw new CliUsageError(
      "Usage: vibefm generate audio <name> [--quality <level>] [--force]",
    );
  }

  let name: string | undefined;
  let quality = "standard";
  let force = false;

  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--quality") {
      const level = rest[++i];
      if (
        level === undefined ||
        !(VALID_QUALITY_LEVELS as readonly string[]).includes(level)
      ) {
        throw new CliUsageError(
          `Invalid quality level. Must be one of: ${VALID_QUALITY_LEVELS.join(", ")}`,
        );
      }
      quality = level;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
    if (name !== undefined) {
      throw new CliUsageError(
        "Usage: vibefm generate audio <name> [--quality <level>] [--force]",
      );
    }
    name = arg;
  }

  if (name === undefined) {
    throw new CliUsageError(
      "Usage: vibefm generate audio <name> [--quality <level>] [--force]",
    );
  }

  return { name, quality, force };
}

const VALID_TTS_VOICES = [
  "冰糖",
  "茉莉",
  "苏打",
  "白桦",
  "Mia",
  "Chloe",
  "Milo",
  "Dean",
  "mimo_default",
] as const;

function parseGenerateSpeechArgs(args: string[]): {
  name: string;
  voice: TtsVoice;
  force: boolean;
} {
  if (args[0] !== "speech") {
    throw new CliUsageError(
      "Usage: vibefm generate speech <name> [--voice <voice>] [--force]",
    );
  }

  let name: string | undefined;
  let voice: TtsVoice = "冰糖";
  let force = false;

  const rest = args.slice(1);
  for (let i = 0; i < rest.length; i++) {
    const arg = rest[i];
    if (arg === "--force") {
      force = true;
      continue;
    }
    if (arg === "--voice") {
      const voiceName = rest[++i];
      if (
        voiceName === undefined ||
        !(VALID_TTS_VOICES as readonly string[]).includes(voiceName)
      ) {
        throw new CliUsageError(
          `Invalid voice. Must be one of: ${VALID_TTS_VOICES.join(", ")}`,
        );
      }
      voice = voiceName as TtsVoice;
      continue;
    }
    if (arg.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${arg}`);
    }
    if (name !== undefined) {
      throw new CliUsageError(
        "Usage: vibefm generate speech <name> [--voice <voice>] [--force]",
      );
    }
    name = arg;
  }

  if (name === undefined) {
    throw new CliUsageError(
      "Usage: vibefm generate speech <name> [--voice <voice>] [--force]",
    );
  }

  return { name, voice, force };
}

function parseGeneratePlanArgs(args: string[]): {
  name: string;
  count?: number;
} {
  const usage = "Usage: vibefm generate plan <name> [--count <number>]";

  if (args.length < 2 || args[0] !== "plan") {
    throw new CliUsageError(usage);
  }

  const name = args[1];
  if (name.startsWith("-")) {
    throw new CliUsageError(usage);
  }

  if (args.length === 2) {
    return { name };
  }

  if (
    args.length !== 4 ||
    args[2] !== "--count" ||
    !/^\d+$/u.test(args[3])
  ) {
    throw new CliUsageError(usage);
  }

  const count = Number(args[3]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new CliUsageError(usage);
  }

  return { name, count };
}

function parseGenerateDetailArgs(args: string[]): {
  name: string;
  limit: number;
} {
  const [subcommand, name, ...rest] = args;
  if (subcommand !== "detail" || !name || name.startsWith("-")) {
    throw new CliUsageError(
      "Usage: vibefm generate detail <name> [--limit <number>]",
    );
  }

  let limit = 10;
  for (let i = 0; i < rest.length; i++) {
    if (rest[i] === "--limit") {
      if (i + 1 >= rest.length || !/^\d+$/u.test(rest[i + 1])) {
        throw new CliUsageError(
          "Usage: vibefm generate detail <name> [--limit <number>]",
        );
      }
      limit = Number(rest[i + 1]);
      if (!Number.isSafeInteger(limit) || limit <= 0) {
        throw new CliUsageError(
          "Usage: vibefm generate detail <name> [--limit <number>]",
        );
      }
      i++;
    } else {
      throw new CliUsageError(
        "Usage: vibefm generate detail <name> [--limit <number>]",
      );
    }
  }

  return { name, limit };
}

function parseCreateArgs(args: string[]): {
  name: string;
  prompt: string;
  playlistUrl?: string;
  playlistQuery?: string;
} {
  const usage =
    "Usage: vibefm create <name> [prompt] [--playlist-url <url>] [--playlist-query <query>]";

  let name: string | undefined;
  let prompt: string | undefined;
  let playlistUrl: string | undefined;
  let playlistQuery: string | undefined;

  for (let index = 0; index < args.length; index++) {
    const argument = args[index];

    if (argument === "--playlist-url") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(usage);
      }
      playlistUrl = value;
      continue;
    }

    if (argument === "--playlist-query") {
      const value = args[++index];
      if (value === undefined || value.startsWith("--")) {
        throw new CliUsageError(usage);
      }
      playlistQuery = value;
      continue;
    }

    if (argument.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }

    if (name === undefined) {
      name = argument;
    } else if (prompt === undefined) {
      prompt = argument;
    } else {
      throw new CliUsageError(usage);
    }
  }

  if (name === undefined) {
    throw new CliUsageError(usage);
  }

  if (playlistUrl && playlistQuery) {
    throw new CliUsageError(
      "Cannot specify both --playlist-url and --playlist-query.",
    );
  }

  if (!playlistUrl && !playlistQuery && (prompt === undefined || prompt.trim().length === 0)) {
    const envDefaultPrompt = process.env.DEFAULT_PROMPT;
    if (envDefaultPrompt !== undefined && envDefaultPrompt.trim().length > 0) {
      prompt = envDefaultPrompt;
    } else {
      throw new CliUsageError(usage);
    }
  }

  return {
    name,
    prompt: prompt ?? "",
    playlistUrl,
    playlistQuery,
  };
}

function parseStatusArgs(args: string[]): { name: string } {
  if (args.length !== 1) {
    throw new CliUsageError("Usage: vibefm status <name>");
  }
  return { name: args[0] };
}

function parseShowArgs(
  args: string[],
): { mode: "list" } | { mode: "detail"; name: string } {
  if (args.length === 0) {
    throw new CliUsageError("Usage: vibefm show list | vibefm show <name>");
  }
  if (args[0] === "list") {
    return { mode: "list" };
  }
  if (args.length !== 1) {
    throw new CliUsageError("Usage: vibefm show <name>");
  }
  return { mode: "detail", name: args[0] };
}

function parseDeleteArgs(args: string[]): { name: string; force: boolean } {
  let name: string | undefined;
  let force = false;

  for (const argument of args) {
    if (argument === "--force") {
      force = true;
      continue;
    }
    if (argument.startsWith("--")) {
      throw new CliUsageError(`Unknown option: ${argument}`);
    }
    if (name !== undefined) {
      throw new CliUsageError("Usage: vibefm delete <name> [--force]");
    }
    name = argument;
  }

  if (name === undefined) {
    throw new CliUsageError("Usage: vibefm delete <name> [--force]");
  }

  return { name, force };
}

async function confirmDeletion(name: string): Promise<boolean> {
  const readline = createInterface({
    input: process.stdin,
    output: process.stderr,
  });

  try {
    const answer = await readline.question(
      `Delete workspace "${name}" and all its files? [y/N] `,
    );
    return answer.trim().toLowerCase() === "y";
  } finally {
    readline.close();
  }
}

function formatTestMessage(
  cookie: CookieTestResult | null,
  ai: AiTestResult | null,
  errors: string[],
): string {
  const lines: string[] = [];

  if (cookie) {
    const { account } = cookie;
    const vipLabel = account.isVip ? "会员" : "非会员";
    lines.push(
      `网易云 Cookie: 有效 | ${account.nickname ?? "未知用户"} (ID: ${account.userId ?? "N/A"}) | ${vipLabel}`,
    );
  } else {
    lines.push(`网易云 Cookie: ${errors[0] ?? "检测失败"}`);
  }

  if (ai) {
    lines.push(`AI 模型: 正常 | ${ai.model} | ${ai.baseUrl}`);
  } else {
    const aiError = errors.length > 1 ? errors[1] : errors[0] ?? "检测失败";
    lines.push(`AI 模型: ${aiError}`);
  }

  return lines.join("\n");
}
