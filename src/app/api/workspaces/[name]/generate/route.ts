import type { WorkflowProgressEvent } from "@/core/workflow";

const BASE_DIRECTORY = process.cwd();

export const dynamic = "force-dynamic";

export async function GET(
  request: Request,
  { params }: { params: Promise<{ name: string }> },
) {
  const { name } = await params;
  const url = new URL(request.url);
  const count = url.searchParams.has("count")
    ? Number(url.searchParams.get("count"))
    : undefined;
  const quality = url.searchParams.get("quality") ?? undefined;
  const voice = url.searchParams.get("voice") ?? undefined;
  const force = url.searchParams.get("force") === "true";

  const encoder = new TextEncoder();
  const stream = new ReadableStream({
    async start(controller) {
      function send(data: unknown) {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      }

      try {
        const { generateProgramWorkflow } = await import("@/core/workflow");
        const result = await generateProgramWorkflow(name, BASE_DIRECTORY, {
          count,
          quality,
          voice: voice as any,
          force,
          onProgress: (event: WorkflowProgressEvent) => {
            send(event);
          },
        });

        send({ type: "complete", stages: result.stages });
      } catch (error) {
        send({
          type: "error",
          message: error instanceof Error ? error.message : String(error),
        });
      } finally {
        controller.close();
      }
    },
  });

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream",
      "Cache-Control": "no-cache",
      Connection: "keep-alive",
    },
  });
}
