import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { testNeteaseCookie, testAiConfig, TestError } from "./test.js";
import { type AiChatClient } from "./ai.js";

const AI_ENV_KEYS = [
  "MIMO_API_KEY",
  "MIMO_BASE_URL",
  "MIMO_MODEL",
] as const;

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vibefm-test-"));
}

async function withCleanAiEnvironment<T>(
  run: () => Promise<T>,
): Promise<T> {
  const original = Object.fromEntries(
    AI_ENV_KEYS.map((key) => [key, process.env[key]]),
  );

  for (const key of AI_ENV_KEYS) {
    delete process.env[key];
  }

  try {
    return await run();
  } finally {
    for (const key of AI_ENV_KEYS) {
      const value = original[key];
      if (value === undefined) {
        delete process.env[key];
      } else {
        process.env[key] = value;
      }
    }
  }
}

test("testNeteaseCookie throws COOKIE_NOT_FOUND when cookie file is missing", async () => {
  const baseDirectory = await createTempDirectory();

  await assert.rejects(
    testNeteaseCookie(baseDirectory),
    (error: unknown) => {
      assert.ok(error instanceof TestError);
      assert.equal(error.code, "COOKIE_NOT_FOUND");
      assert.match(error.message, /cookie/iu);
      return true;
    },
  );
});

test("testNeteaseCookie throws COOKIE_INVALID when API returns error", async () => {
  const baseDirectory = await createTempDirectory();
  await writeFile(path.join(baseDirectory, ".cookie"), "valid=cookie", "utf8");

  const mockFetch = async () =>
    new Response(JSON.stringify({ code: 301 }), {
      status: 200,
      headers: { "Content-Type": "application/json" },
    });

  await assert.rejects(
    testNeteaseCookie(baseDirectory, mockFetch as unknown as typeof fetch),
    (error: unknown) => {
      assert.ok(error instanceof TestError);
      assert.equal(error.code, "COOKIE_INVALID");
      return true;
    },
  );
});

test("testNeteaseCookie throws COOKIE_INVALID when HTTP fails", async () => {
  const baseDirectory = await createTempDirectory();
  await writeFile(path.join(baseDirectory, ".cookie"), "valid=cookie", "utf8");

  const mockFetch = async () =>
    new Response(null, { status: 500 });

  await assert.rejects(
    testNeteaseCookie(baseDirectory, mockFetch as unknown as typeof fetch),
    (error: unknown) => {
      assert.ok(error instanceof TestError);
      assert.equal(error.code, "COOKIE_INVALID");
      assert.match(error.message, /500/u);
      return true;
    },
  );
});

test("testNeteaseCookie returns account info for valid non-VIP cookie", async () => {
  const baseDirectory = await createTempDirectory();
  await writeFile(
    path.join(baseDirectory, ".cookie"),
    "__csrf=abc123; MUSIC_U=xyz",
    "utf8",
  );

  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        code: 200,
        profile: { userId: 12345, nickname: "testuser" },
        account: { vipType: 0 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const result = await testNeteaseCookie(
    baseDirectory,
    mockFetch as unknown as typeof fetch,
  );

  assert.equal(result.account.valid, true);
  assert.equal(result.account.isVip, false);
  assert.equal(result.account.userId, 12345);
  assert.equal(result.account.nickname, "testuser");
  assert.equal(result.account.vipType, 0);
});

test("testNeteaseCookie returns VIP status for VIP cookie", async () => {
  const baseDirectory = await createTempDirectory();
  await writeFile(
    path.join(baseDirectory, ".cookie"),
    "__csrf=abc123; MUSIC_U=xyz",
    "utf8",
  );

  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        code: 200,
        profile: { userId: 67890, nickname: "vipuser" },
        account: { vipType: 11 },
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const result = await testNeteaseCookie(
    baseDirectory,
    mockFetch as unknown as typeof fetch,
  );

  assert.equal(result.account.valid, true);
  assert.equal(result.account.isVip, true);
  assert.equal(result.account.vipType, 11);
});

test("testNeteaseCookie handles null profile gracefully", async () => {
  const baseDirectory = await createTempDirectory();
  await writeFile(
    path.join(baseDirectory, ".cookie"),
    "__csrf=abc123; MUSIC_U=xyz",
    "utf8",
  );

  const mockFetch = async () =>
    new Response(
      JSON.stringify({
        code: 200,
        profile: null,
        account: null,
      }),
      { status: 200, headers: { "Content-Type": "application/json" } },
    );

  const result = await testNeteaseCookie(
    baseDirectory,
    mockFetch as unknown as typeof fetch,
  );

  assert.equal(result.account.valid, true);
  assert.equal(result.account.isVip, false);
  assert.equal(result.account.userId, null);
  assert.equal(result.account.nickname, null);
});

test("testAiConfig throws AI_CONFIG_INVALID when config is missing", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();

    await assert.rejects(
      testAiConfig(baseDirectory),
      (error: unknown) => {
        assert.ok(error instanceof TestError);
        assert.equal(error.code, "AI_CONFIG_INVALID");
        return true;
      },
    );
  });
});

test("testAiConfig throws AI_REQUEST_FAILED when request fails", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=test-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=test-model",
      ].join("\n"),
      "utf8",
    );

    await assert.rejects(
      testAiConfig(baseDirectory),
      (error: unknown) => {
        assert.ok(error instanceof TestError);
        assert.equal(error.code, "AI_REQUEST_FAILED");
        return true;
      },
    );
  });
});

test("testAiConfig returns config and response on success", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=test-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=test-model",
      ].join("\n"),
      "utf8",
    );

    const client: AiChatClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: "ok" } }],
          }),
        },
      },
    };

    const result = await testAiConfig(baseDirectory, { client });

    assert.equal(result.model, "test-model");
    assert.equal(result.baseUrl, "https://ai.example.com/v1");
    assert.equal(result.response, "ok");
  });
});
