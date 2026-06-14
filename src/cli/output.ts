import { AiRequestError } from "../core/ai.js";
import { AudioDownloadError } from "../core/audio.js";
import { EventGenerationError } from "../core/events.js";
import { PlanGenerationError } from "../core/plans.js";
import { ProgramRenderError } from "../core/render.js";
import { ScriptGenerationError } from "../core/scripts.js";
import { SpeechGenerationError } from "../core/speech.js";
import { WorkflowError } from "../core/workflow.js";
import { WorkspaceError } from "../core/workspaces.js";
import { PlaylistImportError } from "../core/playlists.js";

export interface CliSuccess<T> {
  success: true;
  data: T;
}

export interface CliFailure {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export function writeJson(value: CliSuccess<unknown> | CliFailure): void {
  process.stdout.write(`${JSON.stringify(value)}\n`);
}

export function toCliFailure(error: unknown): CliFailure {
  if (error instanceof WorkspaceError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof PlaylistImportError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof AudioDownloadError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof EventGenerationError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof SpeechGenerationError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof ProgramRenderError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof WorkflowError) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (
    error instanceof PlanGenerationError ||
    error instanceof ScriptGenerationError ||
    error instanceof AiRequestError
  ) {
    return {
      success: false,
      error: { code: error.code, message: error.message },
    };
  }

  if (error instanceof CliUsageError) {
    return {
      success: false,
      error: { code: "INVALID_ARGUMENTS", message: error.message },
    };
  }

  return {
    success: false,
    error: {
      code: "INTERNAL_ERROR",
      message: error instanceof Error ? error.message : "Unknown error.",
    },
  };
}

export class CliUsageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CliUsageError";
  }
}
