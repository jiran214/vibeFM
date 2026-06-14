import { toApiSuccess, errorToResponse } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { deleteWorkspace, getWorkspaceShowDetail, getWorkspaceStatus } = await import("@/core/workspaces");
    const { name } = await params;
    const [detail, status] = await Promise.all([
      getWorkspaceShowDetail(name, BASE_DIRECTORY),
      getWorkspaceStatus(name, BASE_DIRECTORY),
    ]);

    const renderStage = status.stages.find((s) => s.stage === "render");
    const hasOutput = renderStage?.status === "completed";

    return Response.json(
      toApiSuccess({
        ...detail,
        stages: status.stages,
        hasOutput,
      })
    );
  } catch (error) {
    return errorToResponse(error);
  }
}

export async function DELETE(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { deleteWorkspace } = await import("@/core/workspaces");
    const { name } = await params;
    const workspace = await deleteWorkspace(name, BASE_DIRECTORY);
    return Response.json(toApiSuccess({ action: "delete", workspace, deleted: true }));
  } catch (error) {
    return errorToResponse(error);
  }
}
