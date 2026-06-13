import assert from "node:assert/strict";
import { mkdtemp, mkdir, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AiMessage } from "./ai.js";
import {
  generateProgramScript,
  ScriptGenerationError,
} from "./scripts.js";
import { createWorkspace } from "./workspaces.js";

async function createFixture() {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-script-"));
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
    path.join(workspace.path, "plan.json"),
    `${JSON.stringify({
      version: 1,
      generatedAt: "2026-06-13T12:00:00.000Z",
      sourcePlaylist: { id: 100, name: "Midnight Radio" },
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
        {
          order: 1,
          id: 2,
          title: "Second Song",
          artists: ["Second Artist", "Guest Artist"],
          album: "Second Album",
          selectionReason: "A spacious opening",
          emotion: "Reflective",
        },
        {
          order: 2,
          id: 1,
          title: "First Song",
          artists: ["First Artist"],
          album: "First Album",
          selectionReason: "A gentle resolution",
          emotion: "Calm",
        },
      ],
    })}\n`,
  );
  await mkdir(path.join(baseDirectory, "prompts"));
  await writeFile(
    path.join(baseDirectory, "prompts", "script.system.md"),
    "You are a radio script writer.",
  );
  await writeFile(
    path.join(baseDirectory, "prompts", "script.user.md"),
    [
      "Write the show.",
      "INFO={{info_json}}",
      "PLAN={{plan_json}}",
    ].join("\n"),
  );
  return { baseDirectory, workspace };
}

function validAiResponse() {
  return [
    "# Opening",
    "",
    '[host voice_design_prompt="Warm, restrained, and slow"]',
    "Welcome to After Midnight.",
    "[/host]",
    "",
    '[transition type="soft" duration="2s"]',
    '[play id="2" fade_in="2s" fade_out="3s"]',
    "",
    "# Block 1",
    "",
    '[host voice_design_prompt="Reflective and conversational"]',
    "From reflection, we move toward a quieter resolution.",
    "[/host]",
    "",
    '[play id="1" fade_in="2s" fade_out="3s"]',
    "",
    "# Ending",
    "",
    '[host voice_design_prompt="Gentle, calm, and unhurried"]',
    "Thank you for spending this quiet hour with us.",
    "[/host]",
  ].join("\n");
}

test("generateProgramScript writes the validated RadioScript DSL to script.md", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const requests: AiMessage[][] = [];

  const result = await generateProgramScript("night-radio", baseDirectory, {
    now: () => new Date("2026-06-13T13:00:00.000Z"),
    requestAi: async (messages) => {
      requests.push(messages);
      return validAiResponse();
    },
  });

  assert.equal(result.path, path.join(workspace.path, "script.md"));
  assert.equal(result.format, "radio-script-dsl");
  assert.equal(result.trackCount, 2);
  assert.equal(result.theme, "After Midnight");
  assert.equal(requests.length, 1);
  assert.equal(requests[0][0].content, "You are a radio script writer.");
  const userPrompt = String(requests[0][1].content);
  assert.match(userPrompt, /"language":"zh-CN"/u);
  assert.match(userPrompt, /"title":"Second Song"/u);
  assert.doesNotMatch(userPrompt, /generatedAt|sourcePlaylist/u);

  const scriptText = await readFile(result.path, "utf8");
  assert.match(scriptText, /^# Opening$/mu);
  assert.match(scriptText, /Welcome to After Midnight\./u);
  assert.match(scriptText, /\[play id="2" fade_in="2s" fade_out="3s"\]/u);
  assert.match(scriptText, /\[play id="1" fade_in="2s" fade_out="3s"\]/u);
  assert.match(scriptText, /voice_design_prompt="Warm, restrained, and slow"/u);
  assert.match(scriptText, /Thank you for spending this quiet hour/u);
  assert.equal(scriptText, `${validAiResponse()}\n`);
  assert.ok(scriptText.endsWith("[/host]\n"));
});

test("generateProgramScript checks dependencies before requesting AI", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-script-"));
  await createWorkspace("night-radio", "Late-night radio", baseDirectory);
  let requested = false;

  await assert.rejects(
    generateProgramScript("night-radio", baseDirectory, {
      requestAi: async () => {
        requested = true;
        return validAiResponse();
      },
    }),
    (error: unknown) =>
      error instanceof ScriptGenerationError &&
      error.code === "MISSING_SCRIPT_DEPENDENCY",
  );
  assert.equal(requested, false);
});

test("generateProgramScript rejects incomplete plan dependencies", async () => {
  const { baseDirectory, workspace } = await createFixture();
  await writeFile(
    path.join(workspace.path, "plan.json"),
    JSON.stringify({ version: 1, tracks: [] }),
  );

  await assert.rejects(
    generateProgramScript("night-radio", baseDirectory, {
      requestAi: async () => validAiResponse(),
    }),
    (error: unknown) =>
      error instanceof ScriptGenerationError &&
      error.code === "INVALID_SCRIPT_DEPENDENCY",
  );
});

test("generateProgramScript requires valid plan source metadata", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const planPath = path.join(workspace.path, "plan.json");
  const plan = JSON.parse(await readFile(planPath, "utf8"));
  delete plan.sourcePlaylist;
  plan.generatedAt = "not-a-date";
  await writeFile(planPath, JSON.stringify(plan));
  let requested = false;

  await assert.rejects(
    generateProgramScript("night-radio", baseDirectory, {
      requestAi: async () => {
        requested = true;
        return validAiResponse();
      },
    }),
    (error: unknown) =>
      error instanceof ScriptGenerationError &&
      error.code === "INVALID_SCRIPT_DEPENDENCY",
  );
  assert.equal(requested, false);
});

test("generateProgramScript rejects reordered or unknown play events without replacing the script", async () => {
  const { baseDirectory, workspace } = await createFixture();
  const scriptPath = path.join(workspace.path, "script.md");
  await writeFile(scriptPath, "old script\n", "utf8");
  const invalidResponses = [
    validAiResponse()
      .replace('[play id="2"', '[play id="swap"')
      .replace('[play id="1"', '[play id="2"')
      .replace('[play id="swap"', '[play id="1"'),
    validAiResponse().replace('[play id="1"', '[play id="999"'),
  ];

  for (const response of invalidResponses) {
    await assert.rejects(
      generateProgramScript("night-radio", baseDirectory, {
        requestAi: async () => response,
      }),
      (error: unknown) =>
        error instanceof ScriptGenerationError &&
        error.code === "INVALID_AI_SCRIPT_RESPONSE",
    );
    assert.equal(await readFile(scriptPath, "utf8"), "old script\n");
  }
});

test("generateProgramScript rejects non-DSL or incomplete host sections", async () => {
  const { baseDirectory } = await createFixture();
  const invalidResponses = [
    [
      "Welcome to After Midnight.",
      "",
      "[[PLAY:2]]",
      "A transition.",
      "",
      "[[PLAY:1]]",
      "Thank you.",
    ].join("\n"),
    validAiResponse().replace(
      '[host voice_design_prompt="Warm, restrained, and slow"]',
      "[host]",
    ),
    validAiResponse().replace(
      "Thank you for spending this quiet hour with us.",
      "   ",
    ),
    validAiResponse().replace(
      [
        '[host voice_design_prompt="Reflective and conversational"]',
        "From reflection, we move toward a quieter resolution.",
        "[/host]",
        "",
      ].join("\n"),
      "",
    ),
  ];

  for (const response of invalidResponses) {
    await assert.rejects(
      generateProgramScript("night-radio", baseDirectory, {
        requestAi: async () => response,
      }),
      (error: unknown) =>
        error instanceof ScriptGenerationError &&
        error.code === "INVALID_AI_SCRIPT_RESPONSE",
    );
  }
});

test("generateProgramScript rejects missing prompt placeholders", async () => {
  const { baseDirectory } = await createFixture();
  await writeFile(
    path.join(baseDirectory, "prompts", "script.user.md"),
    "Missing required placeholders",
  );

  await assert.rejects(
    generateProgramScript("night-radio", baseDirectory, {
      requestAi: async () => validAiResponse(),
    }),
    (error: unknown) =>
      error instanceof ScriptGenerationError &&
      error.code === "PROMPT_TEMPLATE_ERROR",
  );
});
