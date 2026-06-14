import assert from "node:assert/strict";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import {
  EventGenerationError,
  generateProgramEvents,
  parseRadioEvents,
} from "./events.js";
import { createWorkspace } from "./workspaces.js";

function completeScript(): string {
  return `---
title: 城市夜行
voice_design_prompt: 温柔、低声、语速偏慢
---

# Opening
<audio source="/audio/33894312.wav" role="bed" start="0s" volume="25%" fade_in="3s" fade_out="2s">
<host duck_to="12%" duck_fade="0.8s">
晚上好，欢迎来到《城市夜行》。
</host>
</audio>
<pause duration="1s" />
<audio source="sfx/radio_noise" role="effect" volume="15%" />
<crossfade duration="2s" />
<audio source="/audio/33894312.wav" role="main" start="20s" duration="90s" volume="100%" fade_in="2s" fade_out="3s" />

# Ending
<host voice_design_prompt="温柔、放松、有晚安感">
我们下次再见。
</host>`;
}

test("parseRadioEvents converts RadioScript into an ordered event stream", () => {
  assert.deepEqual(parseRadioEvents(completeScript()), [
    {
      type: "audio",
      action: "start",
      source: "/audio/33894312.wav",
      role: "bed",
      start: 0,
      volume: 0.25,
      fadeIn: 3,
      fadeOut: 2,
    },
    {
      type: "audio",
      id: "host-001",
      source: "",
      role: "host",
      voiceDesignPrompt: "温柔、低声、语速偏慢",
      text: "晚上好，欢迎来到《城市夜行》。",
      duckTo: 0.12,
      duckFade: 0.8,
    },
    { type: "audio", action: "stop", role: "bed" },
    { type: "pause", duration: 1 },
    { type: "audio", source: "sfx/radio_noise", role: "effect", volume: 0.15 },
    { type: "crossfade", duration: 2 },
    {
      type: "audio",
      source: "/audio/33894312.wav",
      role: "main",
      start: 20,
      duration: 90,
      volume: 1,
      fadeIn: 2,
      fadeOut: 3,
    },
    {
      type: "audio",
      id: "host-002",
      source: "",
      role: "host",
      voiceDesignPrompt: "温柔、放松、有晚安感",
      text: "我们下次再见。",
    },
  ]);
});

test("generateProgramEvents writes events.json atomically", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-events-"));
  const workspace = await createWorkspace("night-radio", "深夜节目", baseDirectory);
  await writeFile(path.join(workspace.path, "script.md"), completeScript());

  const result = await generateProgramEvents("night-radio", baseDirectory);

  assert.equal(result.path, path.join(workspace.path, "events.json"));
  assert.equal(result.eventCount, 8);
  assert.equal(result.hostCount, 2);
  assert.equal(result.playCount, 1);
  assert.deepEqual(
    JSON.parse(await readFile(result.path, "utf8")),
    parseRadioEvents(completeScript()),
  );
});

test("generateProgramEvents reports a missing script dependency", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-events-"));
  await createWorkspace("night-radio", "深夜节目", baseDirectory);

  await assert.rejects(
    generateProgramEvents("night-radio", baseDirectory),
    (error: unknown) =>
      error instanceof EventGenerationError &&
      error.code === "MISSING_EVENTS_DEPENDENCY",
  );
});

test("invalid DSL does not replace an existing events.json", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-events-"));
  const workspace = await createWorkspace("night-radio", "深夜节目", baseDirectory);
  const eventsPath = path.join(workspace.path, "events.json");
  await writeFile(eventsPath, "old events\n");

  const invalidScripts = [
    completeScript().replace('volume="25%"', 'volume="101%"'),
    completeScript().replace('<pause duration="1s" />', '<pause duration="soon" />'),
    completeScript().replace('role="effect"', 'role="unknown"'),
    completeScript().replace(
      'role="main" start="20s"',
      'role="main" extra="value" start="20s"',
    ),
  ];

  for (const script of invalidScripts) {
    await writeFile(path.join(workspace.path, "script.md"), script);
    await assert.rejects(
      generateProgramEvents("night-radio", baseDirectory),
      (error: unknown) =>
        error instanceof EventGenerationError &&
        error.code === "INVALID_EVENTS_DEPENDENCY",
    );
    assert.equal(await readFile(eventsPath, "utf8"), "old events\n");
  }
});
