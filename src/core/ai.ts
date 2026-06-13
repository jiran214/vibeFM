import { readFile } from "node:fs/promises";
import path from "node:path";

import { parse } from "dotenv";
import OpenAI from "openai";
import type { ChatCompletionMessageParam } from "openai/resources/chat/completions";

const AI_ENV_KEYS = [
  "MIMO_API_KEY",
  "MIMO_BASE_URL",
  "MIMO_MODEL",
] as const;

type AiEnvironmentKey = (typeof AI_ENV_KEYS)[number];

export type AiRequestErrorCode =
  | "INVALID_AI_CONFIG"
  | "AI_REQUEST_FAILED"
  | "EMPTY_AI_RESPONSE";

export class AiRequestError extends Error {
  constructor(
    public readonly code: AiRequestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "AiRequestError";
  }
}

export interface AiConfig {
  apiKey: string;
  baseUrl: string;
  model: string;
}

export type AiMessage = ChatCompletionMessageParam;

interface AiChatCompletion {
  choices: Array<{
    message: {
      content: string | null;
    };
  }>;
}

interface AiChatCompletionRequest {
  model: string;
  messages: ChatCompletionMessageParam[];
  response_format?: { type: "json_object" | "text" };
}

export interface AiChatClient {
  chat: {
    completions: {
      create(request: AiChatCompletionRequest): Promise<AiChatCompletion>;
    };
  };
}

export interface AiRequestOptions {
  baseDirectory?: string;
  client?: AiChatClient;
  responseFormat?: { type: "json_object" | "text" };
}

export async function loadAiConfig(
  baseDirectory = process.cwd(),
): Promise<AiConfig> {
  const fileEnvironment = await readProjectEnvironment(baseDirectory);
  const environment = Object.fromEntries(
    AI_ENV_KEYS.map((key) => [key, process.env[key] ?? fileEnvironment[key]]),
  ) as Record<AiEnvironmentKey, string | undefined>;
  const missingKeys = AI_ENV_KEYS.filter(
    (key) => environment[key]?.trim().length === 0 || environment[key] === undefined,
  );

  if (missingKeys.length > 0) {
    throw new AiRequestError(
      "INVALID_AI_CONFIG",
      `Missing required AI configuration: ${missingKeys.join(", ")}.`,
    );
  }

  return {
    apiKey: environment.MIMO_API_KEY!.trim(),
    baseUrl: environment.MIMO_BASE_URL!.trim(),
    model: environment.MIMO_MODEL!.trim(),
  };
}

export async function requestAiText(
  messages: ChatCompletionMessageParam[],
  options: AiRequestOptions = {},
): Promise<string> {
  const config = await loadAiConfig(options.baseDirectory);
  const client: AiChatClient =
    options.client ??
    new OpenAI({
      apiKey: config.apiKey,
      baseURL: config.baseUrl,
    });

  let completion: AiChatCompletion;
  try {
    completion = await client.chat.completions.create({
      model: config.model,
      messages,
      ...(options.responseFormat && { response_format: options.responseFormat }),
    });
  } catch (error) {
    throw new AiRequestError(
      "AI_REQUEST_FAILED",
      `AI request failed: ${describeError(error, config.apiKey)}`,
      { cause: error },
    );
  }

  const content = completion.choices
    .map((choice) => choice.message.content)
    .find((value): value is string => value?.trim().length !== 0 && value !== null);

  if (content === undefined) {
    throw new AiRequestError(
      "EMPTY_AI_RESPONSE",
      "AI response did not contain text content.",
    );
  }

  return content;
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

    throw new AiRequestError(
      "INVALID_AI_CONFIG",
      `Unable to read AI configuration from ${envPath}.`,
      { cause: error },
    );
  }
}

function describeError(error: unknown, apiKey: string): string {
  const message = error instanceof Error ? error.message : "Unknown provider error";
  return apiKey.length === 0 ? message : message.replaceAll(apiKey, "[redacted]");
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
