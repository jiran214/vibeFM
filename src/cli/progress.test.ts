import assert from "node:assert/strict";
import test from "node:test";

import { runWithBlockingNotice } from "./progress.js";

test("runWithBlockingNotice writes a notice before awaiting the operation", async () => {
  const events: string[] = [];

  const result = await runWithBlockingNotice(
    "AI 正在生成，请稍候...",
    async () => {
      events.push("operation");
      return 42;
    },
    (message) => events.push(message),
  );

  assert.equal(result, 42);
  assert.deepEqual(events, ["AI 正在生成，请稍候...\n", "operation"]);
});

test("runWithBlockingNotice preserves operation failures", async () => {
  const messages: string[] = [];
  const failure = new Error("provider unavailable");

  await assert.rejects(
    runWithBlockingNotice(
      "AI 正在生成，请稍候...",
      async () => {
        throw failure;
      },
      (message) => messages.push(message),
    ),
    failure,
  );
  assert.deepEqual(messages, ["AI 正在生成，请稍候...\n"]);
});
