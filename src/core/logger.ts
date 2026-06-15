import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";

import { loadAiConfig, type AiMessage } from "./ai.js";

const LOGS_DIR = "logs";

type LogCategory = "llm" | "tts";

const TASK_TO_CATEGORY: Record<AiLogContext["task"], LogCategory> = {
  "generate-plan": "llm",
  "generate-script": "llm",
  tts: "tts",
  "tts-voiceclone": "tts",
  "tts-voicedesign": "tts",
};

export interface AiLogContext {
  task: "generate-plan" | "generate-script" | "tts" | "tts-voiceclone" | "tts-voicedesign";
  workspace: string;
  model?: string;
}

export async function writeAiLog(
  baseDirectory: string,
  messages: AiMessage[],
  context: AiLogContext,
  result: { response?: string; error?: string },
): Promise<void> {
  const category = TASK_TO_CATEGORY[context.task];
  const logsDir = path.join(baseDirectory, LOGS_DIR, category);
  await mkdir(logsDir, { recursive: true });

  const timestamp = new Date().toISOString();
  const safeName = timestamp.replace(/[:.]/g, "-");
  const filePath = path.join(logsDir, `${safeName}.md`);

  const sections: string[] = [];

  // Header
  sections.push(`# AI Request Log\n`);
  sections.push(`| Key | Value |`);
  sections.push(`|-----|-------|`);
  sections.push(`| Task | ${context.task} |`);
  sections.push(`| Workspace | ${context.workspace} |`);
  sections.push(`| Model | ${context.model ?? "unknown"} |`);
  sections.push(`| Time | ${timestamp} |`);
  sections.push(`| Status | ${result.error ? "ERROR" : "SUCCESS"} |`);
  sections.push(``);

  // Messages
  sections.push(`---\n`);
  sections.push(`## Messages\n`);
  for (const msg of messages) {
    const role = msg.role.toUpperCase();
    const content = typeof msg.content === "string" ? msg.content : JSON.stringify(msg.content, null, 2);
    sections.push(`### ${role}\n`);
    sections.push("```");
    sections.push(content);
    sections.push("```\n");
  }

  // Response
  sections.push(`---\n`);
  sections.push(`## Response\n`);
  if (result.response) {
    sections.push("```");
    sections.push(result.response);
    sections.push("```\n");
  }
  if (result.error) {
    sections.push("**Error:**\n");
    sections.push("```");
    sections.push(result.error);
    sections.push("```\n");
  }

  await writeFile(filePath, sections.join("\n"), "utf8");
}

export function withAiLogging(
  requestAi: (messages: AiMessage[]) => Promise<string>,
  baseDirectory: string,
  context: AiLogContext,
): (messages: AiMessage[]) => Promise<string> {
  return async (messages: AiMessage[]) => {
    const config = await loadAiConfig(baseDirectory).catch(() => undefined);
    const enrichedContext = config
      ? { ...context, model: config.model }
      : context;
    try {
      const response = await requestAi(messages);
      await writeAiLog(baseDirectory, messages, enrichedContext, { response });
      return response;
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      await writeAiLog(baseDirectory, messages, enrichedContext, { error: errorMessage });
      throw error;
    }
  };
}
