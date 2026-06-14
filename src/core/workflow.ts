import { lstat } from "node:fs/promises";
import path from "node:path";

import {
  generateAudio,
  type AudioDownloadResult,
  type GenerateAudioOptions,
} from "./audio.js";
import {
  generateProgramEvents,
  type ProgramEventsResult,
} from "./events.js";
import {
  generateProgramPlan,
  type ProgramPlanResult,
} from "./plans.js";
import {
  generateProgramRender,
  type ProgramRenderResult,
} from "./render.js";
import {
  generateProgramScript,
  type ProgramScriptResult,
} from "./scripts.js";
import {
  generateSpeech,
  type GenerateSpeechOptions,
  type SpeechGenerationResult,
} from "./speech.js";
import type { TtsVoice } from "./tts.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

export const WORKFLOW_STAGES = [
  "plan",
  "script",
  "events",
  "audio",
  "speech",
  "render",
] as const;

export type WorkflowStage = (typeof WORKFLOW_STAGES)[number];
export type WorkflowProgressStatus =
  | "started"
  | "completed"
  | "skipped"
  | "failed";

export interface WorkflowProgressEvent {
  stage: WorkflowStage;
  index: number;
  total: number;
  status: WorkflowProgressStatus;
}

export interface GenerateWorkflowOptions {
  count?: number;
  quality?: string;
  voice?: TtsVoice;
  force?: boolean;
  onProgress?: (event: WorkflowProgressEvent) => void;
}

export interface WorkflowDependencies {
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

export type WorkflowErrorCode = "MISSING_WORKFLOW_OPTION";

export class WorkflowError extends Error {
  constructor(
    public readonly code: WorkflowErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "WorkflowError";
  }
}

export interface WorkflowStageResult {
  stage: WorkflowStage;
  status: "completed" | "skipped";
}

export interface WorkflowResult {
  workspace: Workspace;
  output: string;
  manifest: string;
  stages: WorkflowStageResult[];
}

const STAGE_ARTIFACTS: Record<WorkflowStage, string[]> = {
  plan: ["plan.json"],
  script: ["script.md"],
  events: ["events.json"],
  audio: ["audio/manifest.json"],
  speech: ["speech/manifest.json"],
  render: ["output/program.mp3", "output/manifest.json"],
};

export async function generateProgramWorkflow(
  workspaceName: string,
  baseDirectory = process.cwd(),
  options: GenerateWorkflowOptions = {},
  dependencies: WorkflowDependencies = {},
): Promise<WorkflowResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const completed = await Promise.all(
    WORKFLOW_STAGES.map((stage) => isStageComplete(workspace.path, stage)),
  );
  const firstPending = completed.findIndex((value) => !value);
  let startIndex = firstPending === -1 ? WORKFLOW_STAGES.length : firstPending;

  if (options.force) {
    startIndex = Math.min(startIndex, WORKFLOW_STAGES.indexOf("audio"));
  }

  const stages: WorkflowStageResult[] = [];
  for (const [index, stage] of WORKFLOW_STAGES.entries()) {
    if (index < startIndex) {
      options.onProgress?.({
        stage,
        index,
        total: WORKFLOW_STAGES.length,
        status: "skipped",
      });
      stages.push({ stage, status: "skipped" });
      continue;
    }

    options.onProgress?.({
      stage,
      index,
      total: WORKFLOW_STAGES.length,
      status: "started",
    });
    try {
      await runStage(
        stage,
        workspaceName,
        baseDirectory,
        options,
        dependencies,
      );
    } catch (error) {
      options.onProgress?.({
        stage,
        index,
        total: WORKFLOW_STAGES.length,
        status: "failed",
      });
      throw error;
    }
    options.onProgress?.({
      stage,
      index,
      total: WORKFLOW_STAGES.length,
      status: "completed",
    });
    stages.push({ stage, status: "completed" });
  }

  return {
    workspace,
    output: path.join(workspace.path, "output", "program.mp3"),
    manifest: path.join(workspace.path, "output", "manifest.json"),
    stages,
  };
}

async function runStage(
  stage: WorkflowStage,
  workspaceName: string,
  baseDirectory: string,
  options: GenerateWorkflowOptions,
  dependencies: WorkflowDependencies,
): Promise<void> {
  switch (stage) {
    case "plan": {
      if (options.count === undefined) {
        throw new WorkflowError(
          "MISSING_WORKFLOW_OPTION",
          "--count is required when the plan stage has not completed.",
        );
      }
      const generatePlan = dependencies.generatePlan ?? generateProgramPlan;
      await generatePlan(workspaceName, options.count, baseDirectory);
      return;
    }
    case "script": {
      const generateScript =
        dependencies.generateScript ?? generateProgramScript;
      await generateScript(workspaceName, baseDirectory);
      return;
    }
    case "events": {
      const generateEvents =
        dependencies.generateEvents ?? generateProgramEvents;
      await generateEvents(workspaceName, baseDirectory);
      return;
    }
    case "audio": {
      const generateAudioStage = dependencies.generateAudio ?? generateAudio;
      await generateAudioStage(workspaceName, baseDirectory, {
        quality: options.quality ?? "standard",
        force: options.force ?? false,
      });
      return;
    }
    case "speech": {
      const generateSpeechStage = dependencies.generateSpeech ?? generateSpeech;
      await generateSpeechStage(workspaceName, baseDirectory, {
        voice: options.voice ?? "冰糖",
        force: options.force ?? false,
      });
      return;
    }
    case "render": {
      const generateRender =
        dependencies.generateRender ?? generateProgramRender;
      await generateRender(workspaceName, baseDirectory);
    }
  }
}

async function isStageComplete(
  workspacePath: string,
  stage: WorkflowStage,
): Promise<boolean> {
  const results = await Promise.all(
    STAGE_ARTIFACTS[stage].map(async (relativePath) => {
      try {
        const entry = await lstat(path.join(workspacePath, relativePath));
        return entry.isFile() && !entry.isSymbolicLink();
      } catch (error) {
        if (isNodeError(error) && error.code === "ENOENT") {
          return false;
        }
        throw error;
      }
    }),
  );
  return results.every(Boolean);
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}
