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
  return `# Opening
[bgm name="soft_ambient" volume="25" fade_in="3s"]
[host voice_design_prompt="温柔、低声、语速偏慢"]
晚上好，欢迎来到《城市夜行》。
[/host]
[pause 1s]
[sfx name="radio_noise" volume="15"]
[bgm stop fade_out="2s"]
[transition type="soft" duration="2s"]
[play id="33894312" fade_in="2s" fade_out="3s"]

# Ending
[host voice_design_prompt="温柔、放松、有晚安感"]
我们下次再见。
[/host]`;
}

test("parseRadioEvents converts RadioScript into an ordered event stream", () => {
  assert.deepEqual(parseRadioEvents(completeScript()), [
    {
      type: "bgm",
      action: "start",
      name: "soft_ambient",
      volume: 0.25,
      fadeIn: 3,
    },
    {
      type: "host",
      id: "host-001",
      voiceDesignPrompt: "温柔、低声、语速偏慢",
      text: "晚上好，欢迎来到《城市夜行》。",
    },
    { type: "pause", duration: 1 },
    { type: "sfx", name: "radio_noise", volume: 0.15 },
    { type: "bgm", action: "stop", fadeOut: 2 },
    { type: "transition", transitionType: "soft", duration: 2 },
    { type: "play", id: "33894312", fadeIn: 2, fadeOut: 3 },
    {
      type: "host",
      id: "host-002",
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
    completeScript().replace("volume=\"25\"", "volume=\"101\""),
    completeScript().replace("[pause 1s]", "[pause soon]"),
    completeScript().replace(
      'transition type="soft"',
      'transition type="unknown"',
    ),
    completeScript().replace(
      'play id="33894312"',
      'play id="33894312" extra="value"',
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
