import { createReadStream } from "node:fs";
import { lstat } from "node:fs/promises";
import path from "node:path";

import { errorToResponse } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

const CONTENT_TYPES: Record<string, string> = {
  ".mp3": "audio/mpeg",
  ".wav": "audio/wav",
  ".srt": "text/vtt; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".md": "text/markdown; charset=utf-8",
};

function getContentType(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  return CONTENT_TYPES[ext] ?? "application/octet-stream";
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string; path: string[] }> }
) {
  try {
    const { getWorkspacePath } = await import("@/core/workspaces");
    const { name, path: pathSegments } = await params;
    const workspacePath = getWorkspacePath(name, BASE_DIRECTORY);
    const filePath = path.resolve(workspacePath, ...pathSegments);

    // Security: ensure file is within workspace
    if (!filePath.startsWith(workspacePath)) {
      return Response.json(
        { success: false, error: { code: "FORBIDDEN", message: "Path traversal detected" } },
        { status: 403 }
      );
    }

    const stat = await lstat(filePath);
    if (!stat.isFile()) {
      return Response.json(
        { success: false, error: { code: "NOT_FOUND", message: "File not found" } },
        { status: 404 }
      );
    }

    const contentType = getContentType(filePath);
    const range = request.headers.get("Range");

    if (range && contentType.startsWith("audio/")) {
      // Handle Range requests for audio seeking
      const parts = range.replace(/bytes=/, "").split("-");
      const start = parseInt(parts[0], 10);
      const end = parts[1] ? parseInt(parts[1], 10) : stat.size - 1;
      const chunkSize = end - start + 1;

      const stream = createReadStream(filePath, { start, end });
      const readable = new ReadableStream({
        start(controller) {
          stream.on("data", (chunk) => controller.enqueue(new Uint8Array(Buffer.from(chunk))));
          stream.on("end", () => controller.close());
          stream.on("error", (err) => controller.error(err));
        },
      });

      return new Response(readable, {
        status: 206,
        headers: {
          "Content-Range": `bytes ${start}-${end}/${stat.size}`,
          "Accept-Ranges": "bytes",
          "Content-Length": String(chunkSize),
          "Content-Type": contentType,
          "Cache-Control": "public, max-age=3600",
        },
      });
    }

    // Full response
    const stream = createReadStream(filePath);
    const readable = new ReadableStream({
      start(controller) {
        stream.on("data", (chunk) => controller.enqueue(new Uint8Array(Buffer.from(chunk))));
        stream.on("end", () => controller.close());
        stream.on("error", (err) => controller.error(err));
      },
    });

    return new Response(readable, {
      headers: {
        "Content-Length": String(stat.size),
        "Content-Type": contentType,
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=3600",
      },
    });
  } catch (error) {
    return errorToResponse(error);
  }
}
