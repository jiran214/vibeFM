import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "dotenv";
import OpenAI from "openai";

import { writeAiLog, type AiLogContext } from "./logger.js";

const TTS_ENV_KEYS = ["MIMO_API_KEY"] as const;

type TtsEnvironmentKey = (typeof TTS_ENV_KEYS)[number];

export type TtsRequestErrorCode =
  | "INVALID_TTS_CONFIG"
  | "TTS_REQUEST_FAILED"
  | "EMPTY_TTS_RESPONSE"
  | "INVALID_AUDIO_FORMAT";

export class TtsRequestError extends Error {
  constructor(
    public readonly code: TtsRequestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TtsRequestError";
  }
}

export interface TtsConfig {
  apiKey: string;
}

export type TtsModel =
  | "mimo-v2.5-tts"
  | "mimo-v2.5-tts-voicedesign"
  | "mimo-v2.5-tts-voiceclone";

export type TtsVoice =
  | "冰糖"
  | "茉莉"
  | "苏打"
  | "白桦"
  | "Mia"
  | "Chloe"
  | "Milo"
  | "Dean"
  | "mimo_default";

export type TtsAudioFormat = "wav" | "pcm16";

export interface TtsMessage {
  role: "user" | "assistant";
  content: string;
}

export interface TtsAudioConfig {
  format: TtsAudioFormat;
  voice?: TtsVoice | string;
  optimize_text_preview?: boolean;
}

export interface TtsRequestOptions {
  model: TtsModel;
  messages: TtsMessage[];
  audio: TtsAudioConfig;
  stream?: boolean;
}

export interface TtsResponse {
  audioData: string;
  format: TtsAudioFormat;
}

export interface TtsStreamChunk {
  audioData: string;
  done: boolean;
}

export async function loadTtsConfig(
  baseDirectory = process.cwd(),
): Promise<TtsConfig> {
  const fileEnvironment = await readProjectEnvironment(baseDirectory);
  const environment = Object.fromEntries(
    TTS_ENV_KEYS.map((key) => [key, process.env[key] ?? fileEnvironment[key]]),
  ) as Record<TtsEnvironmentKey, string | undefined>;

  const missingKeys = TTS_ENV_KEYS.filter(
    (key) =>
      environment[key]?.trim().length === 0 || environment[key] === undefined,
  );

  if (missingKeys.length > 0) {
    throw new TtsRequestError(
      "INVALID_TTS_CONFIG",
      `Missing required TTS configuration: ${missingKeys.join(", ")}.`,
    );
  }

  return {
    apiKey: environment.MIMO_API_KEY!.trim(),
  };
}

export interface SynthesizeSpeechOptions {
  model?: TtsModel;
  audio?: Partial<TtsAudioConfig>;
  baseDirectory?: string;
  voiceDesignPrompt?: string;
  workspace?: string;
}

export async function synthesizeSpeech(
  text: string,
  voice: TtsVoice = "冰糖",
  options: SynthesizeSpeechOptions = {},
): Promise<TtsResponse> {
  const config = await loadTtsConfig(options.baseDirectory);

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://token-plan-cn.xiaomimimo.com/v1",
  });

  const model = options.model || "mimo-v2.5-tts";
  const format = options.audio?.format || "wav";

  const messages: TtsMessage[] = [
    { role: "user", content: options.voiceDesignPrompt?.trim() ?? "" },
    { role: "assistant", content: text },
  ];

  const logContext: AiLogContext = {
    task: "tts",
    workspace: options.workspace ?? "unknown",
    model,
  };

  const logMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  try {
    const completion = await client.chat.completions.create({
      model,
      messages,
      audio: {
        format,
        voice,
        ...options.audio,
      },
      stream: false,
    });

    const audioData = (completion as any).choices?.[0]?.message?.audio?.data;

    if (!audioData) {
      throw new TtsRequestError(
        "EMPTY_TTS_RESPONSE",
        "TTS response did not contain audio data.",
      );
    }

    if (options.baseDirectory && options.workspace) {
      await writeAiLog(options.baseDirectory, logMessages, logContext, {
        response: `[audio data: ${audioData.length} chars base64]`,
      });
    }

    return { audioData, format };
  } catch (error) {
    if (options.baseDirectory && options.workspace) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await writeAiLog(options.baseDirectory, logMessages, logContext, {
        error: errorMessage,
      }).catch(() => {});
    }

    if (error instanceof TtsRequestError) {
      throw error;
    }
    throw new TtsRequestError(
      "TTS_REQUEST_FAILED",
      `TTS request failed: ${describeError(error, config.apiKey)}`,
      { cause: error },
    );
  }
}

export async function synthesizeSpeechStream(
  text: string,
  voice: TtsVoice = "冰糖",
  options: SynthesizeSpeechOptions = {},
): Promise<AsyncGenerator<TtsStreamChunk>> {
  const config = await loadTtsConfig(options.baseDirectory);

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://api.xiaomimimo.com/v1",
  });

  const model = options.model || "mimo-v2.5-tts";

  const messages: TtsMessage[] = [
    { role: "user", content: "" },
    { role: "assistant", content: text },
  ];

  const stream = await client.chat.completions.create({
    model,
    messages,
    audio: {
      format: "pcm16",
      voice,
      ...options.audio,
    },
    stream: true,
  });

  return (async function* () {
    for await (const chunk of stream) {
      const audioData = (chunk as any).choices?.[0]?.delta?.audio?.data;
      if (audioData) {
        yield { audioData, done: false };
      }
    }
    yield { audioData: "", done: true };
  })();
}

export interface VoiceCloneOptions {
  audio?: Partial<TtsAudioConfig>;
  baseDirectory?: string;
  workspace?: string;
}

export async function synthesizeWithVoiceClone(
  text: string,
  voiceSamplePath: string,
  options: VoiceCloneOptions = {},
): Promise<TtsResponse> {
  const config = await loadTtsConfig(options.baseDirectory);

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://api.xiaomimimo.com/v1",
  });

  const voiceSample = await readFile(voiceSamplePath);
  const voiceBase64 = voiceSample.toString("base64");
  const mimeType = voiceSamplePath.endsWith(".mp3") ? "audio/mpeg" : "audio/wav";

  const messages: TtsMessage[] = [
    { role: "user", content: "" },
    { role: "assistant", content: text },
  ];

  const logContext: AiLogContext = {
    task: "tts-voiceclone",
    workspace: options.workspace ?? "unknown",
    model: "mimo-v2.5-tts-voiceclone",
  };

  const logMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  try {
    const completion = await client.chat.completions.create({
      model: "mimo-v2.5-tts-voiceclone",
      messages,
      audio: {
        format: "wav",
        voice: `data:${mimeType};base64,${voiceBase64}`,
        ...options.audio,
      },
      stream: false,
    });

    const audioData = (completion as any).choices?.[0]?.message?.audio?.data;

    if (!audioData) {
      throw new TtsRequestError(
        "EMPTY_TTS_RESPONSE",
        "TTS response did not contain audio data.",
      );
    }

    if (options.baseDirectory && options.workspace) {
      await writeAiLog(options.baseDirectory, logMessages, logContext, {
        response: `[audio data: ${audioData.length} chars base64]`,
      });
    }

    return { audioData, format: "wav" };
  } catch (error) {
    if (options.baseDirectory && options.workspace) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await writeAiLog(options.baseDirectory, logMessages, logContext, {
        error: errorMessage,
      }).catch(() => {});
    }

    if (error instanceof TtsRequestError) {
      throw error;
    }
    throw new TtsRequestError(
      "TTS_REQUEST_FAILED",
      `TTS request failed: ${describeError(error, config.apiKey)}`,
      { cause: error },
    );
  }
}

export interface VoiceDesignOptions {
  audio?: Partial<TtsAudioConfig>;
  baseDirectory?: string;
  workspace?: string;
}

export async function designVoice(
  description: string,
  text?: string,
  options: VoiceDesignOptions = {},
): Promise<TtsResponse> {
  const config = await loadTtsConfig(options.baseDirectory);

  const client = new OpenAI({
    apiKey: config.apiKey,
    baseURL: "https://api.xiaomimimo.com/v1",
  });

  const messages: TtsMessage[] = [
    { role: "user", content: description },
    ...(text ? [{ role: "assistant" as const, content: text }] : []),
  ];

  const logContext: AiLogContext = {
    task: "tts-voicedesign",
    workspace: options.workspace ?? "unknown",
    model: "mimo-v2.5-tts-voicedesign",
  };

  const logMessages = messages.map((m) => ({
    role: m.role as "user" | "assistant",
    content: m.content,
  }));

  try {
    const completion = await client.chat.completions.create({
      model: "mimo-v2.5-tts-voicedesign",
      messages,
      audio: {
        format: "wav" as const,
        voice: "mimo_default",
        optimize_text_preview: true,
        ...options.audio,
      },
      stream: false,
    });

    const audioData = (completion as any).choices?.[0]?.message?.audio?.data;

    if (!audioData) {
      throw new TtsRequestError(
        "EMPTY_TTS_RESPONSE",
        "TTS response did not contain audio data.",
      );
    }

    if (options.baseDirectory && options.workspace) {
      await writeAiLog(options.baseDirectory, logMessages, logContext, {
        response: `[audio data: ${audioData.length} chars base64]`,
      });
    }

    return { audioData, format: "wav" };
  } catch (error) {
    if (options.baseDirectory && options.workspace) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await writeAiLog(options.baseDirectory, logMessages, logContext, {
        error: errorMessage,
      }).catch(() => {});
    }

    if (error instanceof TtsRequestError) {
      throw error;
    }
    throw new TtsRequestError(
      "TTS_REQUEST_FAILED",
      `TTS request failed: ${describeError(error, config.apiKey)}`,
      { cause: error },
    );
  }
}

export function decodeAudioData(base64Data: string): Buffer {
  return Buffer.from(base64Data, "base64");
}

async function readProjectEnvironment(
  baseDirectory: string,
): Promise<Record<string, string>> {
  const envPath = path.resolve(baseDirectory, ".env");

  try {
    return parse(await readFile(envPath));
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      return {};
    }

    throw new TtsRequestError(
      "INVALID_TTS_CONFIG",
      `Unable to read TTS configuration from ${envPath}.`,
      { cause: error },
    );
  }
}

function describeError(error: unknown, apiKey: string): string {
  const message =
    error instanceof Error ? error.message : "Unknown provider error";
  return apiKey.length === 0 ? message : message.replaceAll(apiKey, "[redacted]");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
