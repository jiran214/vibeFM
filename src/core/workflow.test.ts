import assert from "node:assert/strict";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AudioDownloadResult } from "./audio.js";
import type { ProgramEventsResult } from "./events.js";
import type { ProgramPlanResult } from "./plans.js";
import type { ProgramRenderResult } from "./render.js";
import type { ProgramScriptResult } from "./scripts.js";
import type { SpeechGenerationResult } from "./speech.js";
import {
  generateProgramWorkflow,
  WorkflowError,
  type WorkflowDependencies,
  type WorkflowProgressEvent,
} from "./workflow.js";
import { createWorkspace, type Workspace } from "./workspaces.js";

async function setupWorkspace() {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-workflow-"));
  const workspace = await createWorkspace("demo", "Night radio", baseDirectory);
  return { baseDirectory, workspace };
}

async function writeArtifact(workspace: Workspace, relativePath: string) {
  const artifactPath = path.join(workspace.path, relativePath);
  await mkdir(path.dirname(artifactPath), { recursive: true });
  await writeFile(artifactPath, "complete");
}

function createDependencies(
  workspace: Workspace,
  calls: string[],
): WorkflowDependencies {
  return {
    generatePlan: async (_name, count, baseDirectory) => {
      calls.push(`plan:${count}:${baseDirectory}`);
      await writeArtifact(workspace, "plan.json");
      return {
        workspace,
        path: path.join(workspace.path, "plan.json"),
        trackCount: count,
        theme: "Night",
      } satisfies ProgramPlanResult;
    },
    generateScript: async () => {
      calls.push("script");
      await writeArtifact(workspace, "script.md");
      return {
        workspace,
        path: path.join(workspace.path, "script.md"),
        trackCount: 3,
        theme: "Night",
        format: "radio-script-dsl",
      } satisfies ProgramScriptResult;
    },
    generateEvents: async () => {
      calls.push("events");
      await writeArtifact(workspace, "events.json");
      return {
        workspace,
        path: path.join(workspace.path, "events.json"),
        eventCount: 6,
        hostCount: 3,
        playCount: 3,
      } satisfies ProgramEventsResult;
    },
    generateAudio: async (_name, _baseDirectory, options) => {
      calls.push(`audio:${options.quality}:${options.force}`);
      await writeArtifact(workspace, "audio/manifest.json");
      return {
        workspace,
        directory: path.join(workspace.path, "audio"),
        manifest: path.join(workspace.path, "audio", "manifest.json"),
        trackCount: 3,
        downloadedCount: 3,
        placeholderCount: 0,
        warnings: [],
      } satisfies AudioDownloadResult;
    },
    generateSpeech: async (_name, _baseDirectory, options) => {
      calls.push(`speech:${options.voice}:${options.force}`);
      await writeArtifact(workspace, "speech/manifest.json");
      return {
        workspace,
        directory: path.join(workspace.path, "speech"),
        manifest: path.join(workspace.path, "speech", "manifest.json"),
        segmentCount: 3,
        synthesizedCount: 3,
        placeholderCount: 0,
        warnings: [],
      } satisfies SpeechGenerationResult;
    },
    generateRender: async () => {
      calls.push("render");
      await writeArtifact(workspace, "output/program.mp3");
      await writeArtifact(workspace, "output/manifest.json");
      return {
        workspace,
        path: path.join(workspace.path, "output", "program.mp3"),
        manifest: path.join(workspace.path, "output", "manifest.json"),
        durationSeconds: 120,
        eventCount: 6,
        inputCount: 6,
      } satisfies ProgramRenderResult;
    },
  };
}

test("generateProgramWorkflow runs every stage in order and forwards options", async () => {
  const { baseDirectory, workspace } = await setupWorkspace();
  const calls: string[] = [];
  const progress: WorkflowProgressEvent[] = [];

  const result = await generateProgramWorkflow(
    "demo",
    baseDirectory,
    {
      count: 3,
      quality: "exhigh",
      voice: "茉莉",
      force: false,
      onProgress: (event) => progress.push(event),
    },
    createDependencies(workspace, calls),
  );

  assert.deepEqual(calls, [
    `plan:3:${baseDirectory}`,
    "script",
    "events",
    "audio:exhigh:false",
    "speech:茉莉:false",
    "render",
  ]);
  assert.deepEqual(
    progress.map(({ stage, status }) => `${stage}:${status}`),
    [
      "plan:started",
      "plan:completed",
      "script:started",
      "script:completed",
      "events:started",
      "events:completed",
      "audio:started",
      "audio:completed",
      "speech:started",
      "speech:completed",
      "render:started",
      "render:completed",
    ],
  );
  assert.equal(result.output, path.join(workspace.path, "output", "program.mp3"));
  assert.deepEqual(result.stages, [
    { stage: "plan", status: "completed" },
    { stage: "script", status: "completed" },
    { stage: "events", status: "completed" },
    { stage: "audio", status: "completed" },
    { stage: "speech", status: "completed" },
    { stage: "render", status: "completed" },
  ]);
});

test("generateProgramWorkflow resumes after the failed stage on the next run", async () => {
  const { baseDirectory, workspace } = await setupWorkspace();
  await writeArtifact(workspace, "plan.json");
  const firstCalls: string[] = [];
  const firstProgress: WorkflowProgressEvent[] = [];
  const firstDependencies = createDependencies(workspace, firstCalls);
  firstDependencies.generateEvents = async () => {
    firstCalls.push("events");
    throw new Error("interrupted");
  };

  await assert.rejects(
    generateProgramWorkflow(
      "demo",
      baseDirectory,
      { onProgress: (event) => firstProgress.push(event) },
      firstDependencies,
    ),
    /interrupted/u,
  );
  assert.deepEqual(firstCalls, ["script", "events"]);
  assert.deepEqual(
    firstProgress.map(({ stage, status }) => `${stage}:${status}`),
    [
      "plan:skipped",
      "script:started",
      "script:completed",
      "events:started",
      "events:failed",
    ],
  );

  const secondCalls: string[] = [];
  await generateProgramWorkflow(
    "demo",
    baseDirectory,
    {},
    createDependencies(workspace, secondCalls),
  );
  assert.deepEqual(secondCalls, [
    "events",
    "audio:standard:false",
    "speech:冰糖:false",
    "render",
  ]);
});

test("generateProgramWorkflow force reruns media and downstream render", async () => {
  const { baseDirectory, workspace } = await setupWorkspace();
  for (const artifact of [
    "plan.json",
    "script.md",
    "events.json",
    "audio/manifest.json",
    "speech/manifest.json",
    "output/program.mp3",
    "output/manifest.json",
  ]) {
    await writeArtifact(workspace, artifact);
  }
  const calls: string[] = [];

  const result = await generateProgramWorkflow(
    "demo",
    baseDirectory,
    { quality: "lossless", voice: "Mia", force: true },
    createDependencies(workspace, calls),
  );

  assert.deepEqual(calls, [
    "audio:lossless:true",
    "speech:Mia:true",
    "render",
  ]);
  assert.deepEqual(result.stages.slice(0, 3), [
    { stage: "plan", status: "skipped" },
    { stage: "script", status: "skipped" },
    { stage: "events", status: "skipped" },
  ]);
});

test("generateProgramWorkflow requires count only when plan must run", async () => {
  const { baseDirectory, workspace } = await setupWorkspace();

  await assert.rejects(
    generateProgramWorkflow(
      "demo",
      baseDirectory,
      {},
      createDependencies(workspace, []),
    ),
    (error: unknown) =>
      error instanceof WorkflowError &&
      error.code === "MISSING_WORKFLOW_OPTION",
  );
});
