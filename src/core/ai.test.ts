import assert from "node:assert/strict";
import { mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  AiRequestError,
  loadAiConfig,
  requestAiText,
  type AiChatClient,
} from "./ai.js";

const AI_ENV_KEYS = [
  "MIMO_API_KEY",
  "MIMO_BASE_URL",
  "MIMO_MODEL",
] as const;

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vibefm-ai-"));
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

test("loadAiConfig reads OpenAI-compatible settings from .env", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=file-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=example-model",
      ].join("\n"),
      "utf8",
    );

    const config = await loadAiConfig(baseDirectory);

    assert.deepEqual(config, {
      apiKey: "file-key",
      baseUrl: "https://ai.example.com/v1",
      model: "example-model",
    });
  });
});

test("loadAiConfig prefers existing process environment values", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=file-key",
        "MIMO_BASE_URL=https://file.example.com/v1",
        "MIMO_MODEL=file-model",
      ].join("\n"),
      "utf8",
    );
    process.env.MIMO_API_KEY = "process-key";
    process.env.MIMO_MODEL = "process-model";

    const config = await loadAiConfig(baseDirectory);

    assert.deepEqual(config, {
      apiKey: "process-key",
      baseUrl: "https://file.example.com/v1",
      model: "process-model",
    });
  });
});

test("loadAiConfig reports missing settings without exposing secrets", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    const secret = "secret-that-must-not-leak";
    await writeFile(
      path.join(baseDirectory, ".env"),
      `MIMO_API_KEY=${secret}\nMIMO_MODEL=   \n`,
      "utf8",
    );

    await assert.rejects(
      loadAiConfig(baseDirectory),
      (error: unknown) => {
        assert.ok(error instanceof AiRequestError);
        assert.equal(error.code, "INVALID_AI_CONFIG");
        assert.match(error.message, /MIMO_BASE_URL/u);
        assert.match(error.message, /MIMO_MODEL/u);
        assert.doesNotMatch(error.message, new RegExp(secret, "u"));
        return true;
      },
    );
  });
});

test("requestAiText sends configured model and messages", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=test-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=radio-model",
      ].join("\n"),
      "utf8",
    );
    const requests: unknown[] = [];
    const client: AiChatClient = {
      chat: {
        completions: {
          create: async (request) => {
            requests.push(request);
            return {
              choices: [
                { message: { content: null } },
                { message: { content: "  Midnight radio  " } },
              ],
            };
          },
        },
      },
    };
    const messages = [
      { role: "system" as const, content: "You produce radio plans." },
      { role: "user" as const, content: "Plan a midnight show." },
    ];

    const result = await requestAiText(messages, { baseDirectory, client });

    assert.equal(result, "  Midnight radio  ");
    assert.deepEqual(requests, [{ model: "radio-model", messages }]);
  });
});

test("requestAiText wraps provider request failures", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=test-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=radio-model",
      ].join("\n"),
      "utf8",
    );
    const client: AiChatClient = {
      chat: {
        completions: {
          create: async () => {
            throw new Error("provider unavailable");
          },
        },
      },
    };

    await assert.rejects(
      requestAiText([{ role: "user", content: "Hello" }], {
        baseDirectory,
        client,
      }),
      (error: unknown) =>
        error instanceof AiRequestError &&
        error.code === "AI_REQUEST_FAILED" &&
        error.message === "AI request failed: provider unavailable",
    );
  });
});

test("requestAiText passes response_format when specified", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=test-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=radio-model",
      ].join("\n"),
      "utf8",
    );
    const requests: unknown[] = [];
    const client: AiChatClient = {
      chat: {
        completions: {
          create: async (request) => {
            requests.push(request);
            return {
              choices: [{ message: { content: '{"theme":"midnight"}' } }],
            };
          },
        },
      },
    };
    const messages = [
      { role: "user" as const, content: "Return JSON." },
    ];

    const result = await requestAiText(messages, {
      baseDirectory,
      client,
      responseFormat: { type: "json_object" },
    });

    assert.equal(result, '{"theme":"midnight"}');
    assert.deepEqual(requests, [
      {
        model: "radio-model",
        messages,
        response_format: { type: "json_object" },
      },
    ]);
  });
});

test("requestAiText rejects responses without text", async () => {
  await withCleanAiEnvironment(async () => {
    const baseDirectory = await createTempDirectory();
    await writeFile(
      path.join(baseDirectory, ".env"),
      [
        "MIMO_API_KEY=test-key",
        "MIMO_BASE_URL=https://ai.example.com/v1",
        "MIMO_MODEL=radio-model",
      ].join("\n"),
      "utf8",
    );
    const client: AiChatClient = {
      chat: {
        completions: {
          create: async () => ({
            choices: [{ message: { content: "   " } }],
          }),
        },
      },
    };

    await assert.rejects(
      requestAiText([{ role: "user", content: "Hello" }], {
        baseDirectory,
        client,
      }),
      (error: unknown) =>
        error instanceof AiRequestError &&
        error.code === "EMPTY_AI_RESPONSE",
    );
  });
});
