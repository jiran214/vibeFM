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
    theme: {
      title: "After Midnight",
      description: "From restlessness to calm.",
    },
    hostStyle: {
      persona: "A thoughtful late-night companion",
      tone: "Warm and restrained",
      delivery: "Slow with intentional pauses",
    },
    emotionalArc: [
      {
        stage: "Opening",
        description: "Settle into the night",
        trackIds: [2],
      },
      {
        stage: "Landing",
        description: "Arrive at calm",
        trackIds: [1],
      },
    ],
    tracks: [
      { id: 2, selectionReason: "A spacious opening", emotion: "Reflective" },
      { id: 1, selectionReason: "A gentle resolution", emotion: "Calm" },
    ],
  });
}

test("generateProgramPlan compresses inputs and writes an enriched plan", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const requests: AiMessage[][] = [];

  const result = await generateProgramPlan("night-radio", 2, baseDirectory, {
    now: () => new Date("2026-06-13T12:00:00.000Z"),
    requestAi: async (messages) => {
      requests.push(messages);
      return validAiResponse();
    },
  });

  assert.equal(result.path, path.join(workspace.path, "plan.json"));
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
  assert.equal(plan.version, 1);
  assert.equal(plan.generatedAt, "2026-06-13T12:00:00.000Z");
  assert.deepEqual(plan.sourcePlaylist, { id: 100, name: "Midnight Radio" });
  assert.deepEqual(plan.tracks[0], {
    order: 1,
    id: 2,
    title: "Second Song",
    artists: ["Second Artist", "Guest Artist"],
    album: "Second Album",
    selectionReason: "A spacious opening",
    emotion: "Reflective",
  });
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

test("generateProgramPlan rejects invalid AI JSON without replacing an existing plan", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const planPath = path.join(workspace.path, "plan.json");
  await writeFile(planPath, "old plan\n", "utf8");

  await assert.rejects(
    generateProgramPlan("night-radio", 2, baseDirectory, {
      requestAi: async () => "not json",
    }),
    (error: unknown) =>
      error instanceof PlanGenerationError &&
      error.code === "INVALID_AI_PLAN_RESPONSE",
  );
  assert.equal(await readFile(planPath, "utf8"), "old plan\n");
});

test("generateProgramPlan rejects duplicate, unknown, or incomplete song selections", async () => {
  const { baseDirectory } = await createFixture();
  const invalidResponses = [
    {
      ...JSON.parse(validAiResponse()),
      tracks: [
        { id: 1, selectionReason: "Reason", emotion: "Calm" },
        { id: 1, selectionReason: "Reason", emotion: "Calm" },
      ],
    },
    {
      ...JSON.parse(validAiResponse()),
      tracks: [
        { id: 1, selectionReason: "Reason", emotion: "Calm" },
        { id: 999, selectionReason: "Reason", emotion: "Calm" },
      ],
    },
    {
      ...JSON.parse(validAiResponse()),
      emotionalArc: [
        { stage: "Only", description: "Incomplete", trackIds: [2] },
      ],
    },
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
