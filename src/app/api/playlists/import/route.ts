import { toApiSuccess, errorToResponse } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

export async function POST(request: Request) {
  try {
    const { importNeteasePlaylist } = await import("@/core/playlists");
    const { getWorkspace } = await import("@/core/workspaces");

    const body = await request.json();
    const { workspaceName, playlistUrl } = body as {
      workspaceName?: string;
      playlistUrl?: string;
    };

    if (!workspaceName || !playlistUrl) {
      return Response.json(
        {
          success: false,
          error: {
            code: "INVALID_ARGUMENTS",
            message: "workspaceName and playlistUrl are required",
          },
        },
        { status: 400 }
      );
    }

    // Verify workspace exists
    await getWorkspace(workspaceName, BASE_DIRECTORY);

    const result = await importNeteasePlaylist(workspaceName, playlistUrl, BASE_DIRECTORY);
    return Response.json(
      toApiSuccess({
        action: "import",
        playlist: {
          id: result.playlistId,
          name: result.playlistName,
          trackCount: result.trackCount,
          path: result.path,
        },
      })
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
