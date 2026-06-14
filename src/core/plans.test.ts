import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AiMessage } from "./ai.js";
import {
  generateProgramPlan,
  PlanGenerationError,
} from "./plans.js";
import { createWorkspace } from "./workspaces.js";

async function createFixture() {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-plan-"));
  const workspace = await createWorkspace(
    "night-radio",
    "适合深夜独处、情绪逐渐平静的节目",
    baseDirectory,
  );
  await writeFile(
    path.join(workspace.path, "info.json"),
    `${JSON.stringify({
      prompt: "适合深夜独处、情绪逐渐平静的节目",
      language: "zh-CN",
    })}\n`,
  );
  await writeFile(
    path.join(workspace.path, "playlist.json"),
    `${JSON.stringify({
      version: 1,
      importedAt: "2026-06-13T10:00:00.000Z",
      source: { provider: "netease", playlistId: "100" },
      playlist: {
        id: 100,
        name: "Midnight Radio",
        description: "This must not be sent",
        imageUrl: "https://example.com/playlist.jpg",
        tracks: [
          {
            id: 1,
            name: "First Song",
            durationMs: 180000,
            fee: 8,
            artists: [{ id: 11, name: "First Artist" }],
            album: {
              id: 21,
              name: "First Album",
              imageUrl: "https://example.com/first.jpg",
            },
          },
          {
            id: 2,
            name: "Second Song",
            durationMs: 200000,
            artists: [
              { id: 12, name: "Second Artist" },
              { id: 13, name: "Guest Artist" },
            ],
            album: { id: 22, name: "Second Album" },
          },
          {
            id: 3,
            name: "Third Song",
            artists: [{ id: 14, name: "Third Artist" }],
            album: { id: 23, name: "Third Album" },
          },
        ],
      },
    })}\n`,
  );
  await mkdir(path.join(baseDirectory, "prompts"));
  await writeFile(
    path.join(baseDirectory, "prompts", "plan.system.md"),
    "You are a radio planner.",
  );
  await writeFile(
    path.join(baseDirectory, "prompts", "plan.user.md"),
    [
      "Select {{count}} tracks.",
      "INFO={{info_json}}",
      "PLAYLIST={{playlist_json}}",
    ].join("\n"),
  );
  return { baseDirectory, workspace };
}

function validAiResponse() {
  return JSON.stringify({
    think: "从城市夜行的躁动逐步落到独处后的平静，先铺开空间感，再温柔收束。",
    track_ids: [2, 1],
  });
}

test("generateProgramPlan compresses inputs and writes only think and track_ids", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const requests: AiMessage[][] = [];

  const result = await generateProgramPlan("night-radio", 2, baseDirectory, {
    requestAi: async (messages) => {
      requests.push(messages);
      return validAiResponse();
    },
  });

  assert.equal(result.path, path.join(workspace.path, "info.json"));
  assert.equal(result.trackCount, 2);
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0].role, "system");
  assert.equal(requests[0][0].content, "You are a radio planner.");
  const userPrompt = String(requests[0][1].content);
  assert.match(userPrompt, /"language":"zh-CN"/u);
  assert.match(
    userPrompt,
    /\[2,"Second Song",\["Second Artist","Guest Artist"\],"Second Album"\]/u,
  );
  assert.doesNotMatch(
    userPrompt,
    /durationMs|fee|imageUrl|This must not be sent/u,
  );

  const plan = JSON.parse(await readFile(result.path, "utf8"));
  assert.equal(plan.prompt, "适合深夜独处、情绪逐渐平静的节目");
  assert.equal(plan.language, "zh-CN");
  assert.equal(plan.think, "从城市夜行的躁动逐步落到独处后的平静，先铺开空间感，再温柔收束。");
  assert.deepEqual(plan.track_ids, [2, 1]);
});

test("generateProgramPlan rejects a count larger than the playlist", async () => {
  const { baseDirectory } = await createFixture();

  await assert.rejects(
    generateProgramPlan("night-radio", 4, baseDirectory, {
      requestAi: async () => validAiResponse(),
    }),
    (error: unknown) =>
      error instanceof PlanGenerationError &&
      error.code === "INVALID_TRACK_COUNT",
  );
});

test("generateProgramPlan reports a missing dependency before requesting AI", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-plan-"));
  await createWorkspace("night-radio", "Late-night radio", baseDirectory);
  let requested = false;

  await assert.rejects(
    generateProgramPlan("night-radio", 1, baseDirectory, {
      requestAi: async () => {
        requested = true;
        return validAiResponse();
      },
    }),
    (error: unknown) =>
      error instanceof PlanGenerationError &&
      error.code === "MISSING_PLAN_DEPENDENCY",
  );
  assert.equal(requested, false);
});

test("generateProgramPlan rejects invalid AI JSON without replacing an existing info", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const infoPath = path.join(workspace.path, "info.json");
  const originalInfo = await readFile(infoPath, "utf8");

  await assert.rejects(
    generateProgramPlan("night-radio", 2, baseDirectory, {
      requestAi: async () => "not json",
    }),
    (error: unknown) =>
      error instanceof PlanGenerationError &&
      error.code === "INVALID_AI_PLAN_RESPONSE",
  );
  assert.equal(await readFile(infoPath, "utf8"), originalInfo);
});

test("generateProgramPlan rejects duplicate, unknown, wrong-count, or extra plan fields", async () => {
  const { baseDirectory } = await createFixture();
  const invalidResponses = [
    { think: "Reason", track_ids: [1, 1] },
    { think: "Reason", track_ids: [1, 999] },
    { think: "Reason", track_ids: [1] },
    { think: "Reason", track_ids: [2, 1], theme: "extra" },
  ];

  for (const response of invalidResponses) {
    await assert.rejects(
      generateProgramPlan("night-radio", 2, baseDirectory, {
        requestAi: async () => JSON.stringify(response),
      }),
      (error: unknown) =>
        error instanceof PlanGenerationError &&
        error.code === "INVALID_AI_PLAN_RESPONSE",
    );
  }
});

test("generateProgramPlan reports prompt templates with missing placeholders", async () => {
  const { baseDirectory } = await createFixture();
  await writeFile(
    path.join(baseDirectory, "prompts", "plan.user.md"),
    "Missing required placeholders",
  );

  await assert.rejects(
    generateProgramPlan("night-radio", 2, baseDirectory, {
      requestAi: async () => validAiResponse(),
    }),
    (error: unknown) =>
      error instanceof PlanGenerationError &&
      error.code === "PROMPT_TEMPLATE_ERROR",
  );
});
