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
} from "../core/workspaces.js";
import {
  importNeteasePlaylist,
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
  generateProgramScript,
  type ProgramScriptResult,
} from "../core/scripts.js";
import {
  generateSpeech,
  type SpeechGenerationResult,
  type GenerateSpeechOptions,
} from "../core/speech.js";
import type { TtsVoice } from "../core/tts.js";
import { CliUsageError, toCliFailure, writeJson } from "./output.js";
import { runWithBlockingNotice } from "./progress.js";

interface CliDependencies {
  importPlaylist?: (
    workspaceName: string,
    playlistUrl: string,
    baseDirectory: string,
  ) => Promise<PlaylistImportResult>;
  generatePlan?: (
    workspaceName: string,
    count: number,
    baseDirectory: string,
  ) => Promise<ProgramPlanResult>;
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
}

export async function runCli(
  args: string[],
  baseDirectory = process.cwd(),
  dependencies: CliDependencies = {},
): Promise<number> {
  try {
    const [command, ...commandArgs] = args;

    if (command === "create") {
      const { name, prompt } = parseCreateArgs(commandArgs);
      const created = await createWorkspace(name, prompt, baseDirectory);
      writeJson({
        success: true,
        data: {
          action: "create",
          workspace: { name: created.name, path: created.path },
          info: created.info,
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

    if (command === "import") {
      const { name, url } = parseImportArgs(commandArgs);
      const importPlaylist =
        dependencies.importPlaylist ?? importNeteasePlaylist;
      const result = await importPlaylist(name, url, baseDirectory);
      writeJson({
        success: true,
        data: {
          action: "import",
          workspace: result.workspace,
          playlist: {
            id: result.playlistId,
            name: result.playlistName,
            trackCount: result.trackCount,
            path: result.path,
          },
        },
      });
      return 0;
    }

    if (command === "generate") {
      if (commandArgs[0] === "plan") {
        const { name, count } = parseGeneratePlanArgs(commandArgs);
        const generatePlan = dependencies.generatePlan ?? generateProgramPlan;
        const result = await runWithBlockingNotice(
          "AI 正在生成节目策划，请稍候...",
          () => generatePlan(name, count, baseDirectory),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-plan",
            workspace: result.workspace,
            plan: {
              path: result.path,
              trackCount: result.trackCount,
              theme: result.theme,
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
        const { name } = parseGenerateRenderArgs(commandArgs);
        const generateRender =
          dependencies.generateRender ?? generateProgramRender;
        const result = await runWithBlockingNotice(
          "正在合成节目，请稍候...",
          () => generateRender(name, baseDirectory),
        );
        writeJson({
          success: true,
          data: {
            action: "generate-render",
            workspace: result.workspace,
            render: {
              path: result.path,
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
        "Usage: vibefm generate plan <name> --count <number> | vibefm generate script <name> | vibefm generate events <name> | vibefm generate audio <name> [--quality <level>] [--force] | vibefm generate speech <name> [--voice <voice>] [--force] | vibefm generate render <name>",
      );
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

    throw new CliUsageError(
      "Usage: vibefm create <name> <prompt> | vibefm delete <name> [--force] | vibefm import <name> <netease-playlist-url> | vibefm cookie | vibefm generate plan <name> --count <number> | vibefm generate script <name> | vibefm generate events <name> | vibefm generate audio <name> [--quality <level>] [--force] | vibefm generate speech <name> [--voice <voice>] [--force] | vibefm generate render <name>",
    );
  } catch (error) {
    writeJson(toCliFailure(error));
    return 1;
  }
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

function parseGenerateRenderArgs(args: string[]): { name: string } {
  if (args.length !== 2 || args[0] !== "render") {
    throw new CliUsageError("Usage: vibefm generate render <name>");
  }
  return { name: args[1] };
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
  count: number;
} {
  if (
    args.length !== 4 ||
    args[0] !== "plan" ||
    args[2] !== "--count" ||
    !/^\d+$/u.test(args[3])
  ) {
    throw new CliUsageError(
      "Usage: vibefm generate plan <name> --count <number>",
    );
  }

  const count = Number(args[3]);
  if (!Number.isSafeInteger(count) || count <= 0) {
    throw new CliUsageError(
      "Usage: vibefm generate plan <name> --count <number>",
    );
  }

  return { name: args[1], count };
}

function parseImportArgs(args: string[]): { name: string; url: string } {
  if (args.length !== 2) {
    throw new CliUsageError(
      "Usage: vibefm import <name> <netease-playlist-url>",
    );
  }

  return { name: args[0], url: args[1] };
}

function parseCreateArgs(args: string[]): { name: string; prompt: string } {
  if (args.length !== 2 || args[1].trim().length === 0) {
    throw new CliUsageError("Usage: vibefm create <name> <prompt>");
  }
  return { name: args[0], prompt: args[1] };
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
