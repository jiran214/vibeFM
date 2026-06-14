import { toApiSuccess, toApiFailure } from "@/app/api/_lib/response";

const BASE_DIRECTORY = process.cwd();

export async function GET() {
  const { testNeteaseCookie, testAiConfig } = await import("@/core/test");

  const errors: string[] = [];
  let cookieResult = null;
  let aiResult = null;

  try {
    cookieResult = await testNeteaseCookie(BASE_DIRECTORY);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "Cookie test failed");
  }

  try {
    aiResult = await testAiConfig(BASE_DIRECTORY);
  } catch (error) {
    errors.push(error instanceof Error ? error.message : "AI config test failed");
  }

  if (errors.length > 0 && !cookieResult && !aiResult) {
    return Response.json(
      toApiFailure("TEST_FAILED", errors.join("; ")),
      { status: 400 }
    );
  }

  return Response.json(
    toApiSuccess({
      cookie: cookieResult,
      ai: aiResult,
      errors,
    })
  );
}
