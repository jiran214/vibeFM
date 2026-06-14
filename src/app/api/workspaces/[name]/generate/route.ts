import { toApiSuccess, errorToResponse } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

export async function POST(
  request: Request,
  { params }: { params: Promise<{ name: string }> }
) {
  try {
    const { generateProgramWorkflow } = await import("@/core/workflow");
    const { name } = await params;
    const body = await request.json();
    const { count, quality, voice, force } = body as {
      count?: number;
      quality?: string;
      voice?: string;
      force?: boolean;
    };

    const result = await generateProgramWorkflow(name, BASE_DIRECTORY, {
      count,
      quality,
      voice: voice as any,
      force,
    });

    return Response.json(
      toApiSuccess({
        action: "generate",
        workspace: result.workspace,
        output: result.output,
        manifest: result.manifest,
        stages: result.stages,
      })
    );
  } catch (error) {
    return errorToResponse(error);
  }
}
