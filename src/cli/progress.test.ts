import assert from "node:assert/strict";
import test from "node:test";

import {
  createWorkflowProgressReporter,
  runWithBlockingNotice,
} from "./progress.js";

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

test("workflow progress reporter renders stage progress and status", () => {
  const messages: string[] = [];
  const report = createWorkflowProgressReporter((message) => messages.push(message));

  report({ stage: "plan", index: 0, total: 6, status: "started" });
  report({ stage: "plan", index: 0, total: 6, status: "completed" });
  report({ stage: "script", index: 1, total: 6, status: "skipped" });
  report({ stage: "events", index: 2, total: 6, status: "failed" });

  assert.deepEqual(messages, [
    "[------------------------] 0/6  节目策划  进行中\n",
    "[====--------------------] 1/6  节目策划  已完成\n",
    "[========----------------] 2/6  节目文稿  已跳过（产物存在）\n",
    "[========----------------] 2/6  事件流  失败\n",
  ]);
});
