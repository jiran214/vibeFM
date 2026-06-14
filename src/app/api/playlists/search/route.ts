import { toApiSuccess, errorToResponse } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

export async function GET(request: Request) {
  try {
    const { searchNeteasePlaylist } = await import("@/core/playlists");
    const { searchParams } = new URL(request.url);
    const query = searchParams.get("q");

    if (!query) {
      return Response.json(
        { success: false, error: { code: "INVALID_ARGUMENTS", message: "q parameter is required" } },
        { status: 400 }
      );
    }

    const result = await searchNeteasePlaylist(query, BASE_DIRECTORY);
    return Response.json(toApiSuccess(result));
  } catch (error) {
    return errorToResponse(error);
  }
}
