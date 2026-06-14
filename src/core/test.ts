import { loadAiConfig, requestAiText, AiRequestError, type AiChatClient } from "./ai.js";
import { readCookie } from "./cookie.js";

export type TestErrorCode =
  | "COOKIE_NOT_FOUND"
  | "COOKIE_INVALID"
  | "AI_CONFIG_INVALID"
  | "AI_REQUEST_FAILED";

export class TestError extends Error {
  constructor(
    public readonly code: TestErrorCode,
    message: string,
    options?: ErrorOptions,
  ) {
    super(message, options);
    this.name = "TestError";
  }
}

export interface NeteaseAccountResult {
  valid: boolean;
  isVip: boolean;
  userId: number | null;
  nickname: string | null;
  vipType: number;
}

export interface CookieTestResult {
  cookiePath: string;
  account: NeteaseAccountResult;
}

export interface AiTestResult {
  model: string;
  baseUrl: string;
  response: string;
}

export interface TestResult {
  cookie: CookieTestResult | null;
  ai: AiTestResult | null;
  errors: string[];
}

export async function testNeteaseCookie(
  baseDirectory: string,
  fetchImpl: typeof fetch = fetch,
): Promise<CookieTestResult> {
  let cookie: string;
  try {
    cookie = await readCookie(baseDirectory);
  } catch {
    throw new TestError(
      "COOKIE_NOT_FOUND",
      "Cookie 文件不存在，请先运行 npm run cli -- cookie 从浏览器获取",
    );
  }

  const response = await fetchImpl(
    "https://music.163.com/api/nuser/account/get",
    {
      headers: {
        Cookie: cookie,
        Referer: "https://music.163.com/",
        "User-Agent":
          "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vibeFM/0.1",
      },
      signal: AbortSignal.timeout(15_000),
    },
  );

  if (!response.ok) {
    throw new TestError(
      "COOKIE_INVALID",
      `网易云 API 请求失败，HTTP ${response.status}`,
    );
  }

  const json = (await response.json()) as Record<string, unknown>;
  const code = json.code as number | undefined;

  if (code !== 200) {
    throw new TestError(
      "COOKIE_INVALID",
      `网易云 API 返回错误码 ${code}，cookie 可能已失效`,
    );
  }

  const profile = json.profile as Record<string, unknown> | null;
  const account = json.account as Record<string, unknown> | null;

  const userId = profile?.userId as number | null ?? null;
  const nickname = profile?.nickname as string | null ?? null;
  const vipType = (account?.vipType as number) ?? 0;
  const isVip = vipType > 0;

  return {
    cookiePath: `${baseDirectory}/.cookie`,
    account: {
      valid: true,
      isVip,
      userId,
      nickname,
      vipType,
    },
  };
}

export interface TestAiConfigOptions {
  client?: AiChatClient;
}

export async function testAiConfig(
  baseDirectory: string,
  options: TestAiConfigOptions = {},
): Promise<AiTestResult> {
  let config;
  try {
    config = await loadAiConfig(baseDirectory);
  } catch (error) {
    if (error instanceof AiRequestError && error.code === "INVALID_AI_CONFIG") {
      throw new TestError("AI_CONFIG_INVALID", error.message, { cause: error });
    }
    throw error;
  }

  try {
    const response = await requestAiText(
      [{ role: "user", content: "回复 ok" }],
      { baseDirectory, client: options.client },
    );
    return {
      model: config.model,
      baseUrl: config.baseUrl,
      response: response.trim(),
    };
  } catch (error) {
    if (error instanceof AiRequestError) {
      throw new TestError("AI_REQUEST_FAILED", error.message, { cause: error });
    }
    throw error;
  }
}
