import { toApiSuccess, errorToResponse } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

export async function GET() {
  try {
    const { listWorkspaces } = await import("@/core/workspaces");
    const items = await listWorkspaces(BASE_DIRECTORY);
    return Response.json(toApiSuccess({ items }));
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function POST(request: Request) {
  try {
    const { createWorkspace, deleteWorkspace } = await import("@/core/workspaces");
    const { importNeteasePlaylist, searchNeteasePlaylist } = await import("@/core/playlists");

    const body = await request.json();
    const { name, prompt, playlistUrl, playlistQuery } = body as {
      name?: string;
      prompt?: string;
      playlistUrl?: string;
      playlistQuery?: string;
    };

    if (!name || typeof name !== "string") {
      return Response.json(
        { success: false, error: { code: "INVALID_ARGUMENTS", message: "name is required" } },
        { status: 400 }
      );
    }

    const workspacePrompt = prompt ?? "";
    const created = await createWorkspace(name, workspacePrompt, BASE_DIRECTORY);

    let playlistResult;
    if (playlistUrl || playlistQuery) {
      try {
        let resolvedUrl = playlistUrl;
        if (playlistQuery) {
          const searchResult = await searchNeteasePlaylist(playlistQuery, BASE_DIRECTORY);
          resolvedUrl = `https://music.163.com/playlist?id=${searchResult.playlistId}`;
        }
        playlistResult = await importNeteasePlaylist(name, resolvedUrl!, BASE_DIRECTORY);
      } catch (error) {
        await deleteWorkspace(name, BASE_DIRECTORY);
        throw error;
      }
    }

    return Response.json(
      toApiSuccess({
        action: "create",
        workspace: { name: created.name, path: created.path },
        info: created.info,
        ...(playlistResult && {
          playlist: {
            id: playlistResult.playlistId,
            name: playlistResult.playlistName,
            trackCount: playlistResult.trackCount,
            path: playlistResult.path,
          },
        }),
      }),
      { status: 201 }
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
