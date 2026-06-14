export interface ApiSuccess<T> {
  success: true;
  data: T;
}

export interface ApiFailure {
  success: false;
  error: {
    code: string;
    message: string;
  };
}

export type ApiResponse<T> = ApiSuccess<T> | ApiFailure;

export function toApiSuccess<T>(data: T): ApiSuccess<T> {
  return { success: true, data };
}

export function toApiFailure(code: string, message: string): ApiFailure {
  return {
    success: false,
    error: { code, message },
  };
}

function getHttpStatus(error: unknown): number {
  if (!(error instanceof Error)) return 500;

  const name = error.constructor.name;
  const code = (error as any).code;

  // WorkspaceError
  if (name === "WorkspaceError") {
    switch (code) {
      case "WORKSPACE_NOT_FOUND":
        return 404;
      case "WORKSPACE_ALREADY_EXISTS":
        return 409;
      case "INVALID_WORKSPACE_NAME":
      case "INVALID_PROMPT":
        return 400;
      default:
        return 500;
    }
  }

  // PlaylistImportError
  if (name === "PlaylistImportError") {
    switch (code) {
      case "INVALID_PLAYLIST_URL":
      case "INVALID_PLAYLIST_RESPONSE":
        return 400;
      case "NO_SEARCH_RESULTS":
        return 404;
      case "PLAYLIST_REQUEST_FAILED":
      case "SEARCH_REQUEST_FAILED":
        return 502;
      default:
        return 500;
    }
  }

  // AI and other errors
  if (
    name === "PlanGenerationError" ||
    name === "ScriptGenerationError" ||
    name === "AudioDownloadError" ||
    name === "EventGenerationError" ||
    name === "SpeechGenerationError" ||
    name === "ProgramRenderError" ||
    name === "WorkflowError"
  ) {
    return 500;
  }

  if (name === "AiRequestError") {
    return 502;
  }

  return 500;
}

export function errorToResponse(error: unknown): Response {
  const status = getHttpStatus(error);

  if (error instanceof Error) {
    const code = (error as any).code || error.constructor.name || "INTERNAL_ERROR";
    return Response.json(toApiFailure(code, error.message), { status });
  }

  const message = typeof error === "string" ? error : "Unknown error.";
  return Response.json(toApiFailure("INTERNAL_ERROR", message), { status: 500 });
}
