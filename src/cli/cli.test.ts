import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import type { AudioDownloadResult } from "../core/audio.js";
import type { ProgramEventsResult } from "../core/events.js";
import type { ProgramPlanResult } from "../core/plans.js";
import {
  ProgramRenderError,
  type ProgramRenderResult,
} from "../core/render.js";
import type { ProgramScriptResult } from "../core/scripts.js";
import {
  SpeechGenerationError,
  type SpeechGenerationResult,
} from "../core/speech.js";
import { runCli } from "./run.js";

async function captureStdout<T>(callback: () => Promise<T>) {
  let output = "";
  const originalWrite = process.stdout.write.bind(process.stdout);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    output += chunk.toString();
    return true;
  }) as typeof process.stdout.write;

  try {
    return { result: await callback(), output };
  } finally {
    process.stdout.write = originalWrite;
  }
}

async function captureOutput<T>(callback: () => Promise<T>) {
  let stdout = "";
  let stderr = "";
  const originalStdoutWrite = process.stdout.write.bind(process.stdout);
  const originalStderrWrite = process.stderr.write.bind(process.stderr);
  process.stdout.write = ((chunk: string | Uint8Array) => {
    stdout += chunk.toString();
    return true;
  }) as typeof process.stdout.write;
  process.stderr.write = ((chunk: string | Uint8Array) => {
    stderr += chunk.toString();
    return true;
  }) as typeof process.stderr.write;

  try {
    return { result: await callback(), stdout, stderr };
  } finally {
    process.stdout.write = originalStdoutWrite;
    process.stderr.write = originalStderrWrite;
  }
}

test("create command prints JSON and writes the prompt to info.json", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const { result, output } = await captureStdout(() =>
    runCli(
      ["create", "morning-show", "适合清晨通勤的轻松节目"],
      baseDirectory,
    ),
  );

  assert.equal(result, 0);
  const response = JSON.parse(output);
  assert.equal(response.success, true);
  assert.equal(response.data.info.prompt, "适合清晨通勤的轻松节目");
  const infoPath = path.join(
    baseDirectory,
    ".vibefm",
    "morning-show",
    "info.json",
  );
  assert.equal(response.data.info.path, infoPath);
  assert.deepEqual(JSON.parse(await readFile(infoPath, "utf8")), {
    prompt: "适合清晨通勤的轻松节目",
  });
});

test("delete --force prints JSON and removes the workspace", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  await captureStdout(() =>
    runCli(["create", "morning-show", "Morning radio"], baseDirectory),
  );

  const { result, output } = await captureStdout(() =>
    runCli(["delete", "morning-show", "--force"], baseDirectory),
  );

  assert.equal(result, 0);
  assert.equal(JSON.parse(output).data.deleted, true);
  await assert.rejects(
    access(path.join(baseDirectory, ".vibefm", "morning-show")),
    { code: "ENOENT" },
  );
});

test("invalid arguments produce a JSON error", async () => {
  const { result, output } = await captureStdout(() => runCli(["create"]));
  const response = JSON.parse(output);

  assert.equal(result, 1);
  assert.equal(response.success, false);
  assert.equal(response.error.code, "INVALID_ARGUMENTS");
});

test("create command requires a prompt", async () => {
  const { result, output } = await captureStdout(() =>
    runCli(["create", "morning-show"]),
  );

  assert.equal(result, 1);
  assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
});

test("import command prints JSON and writes playlist.json", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  await captureStdout(() =>
    runCli(["create", "morning-show", "Morning radio"], baseDirectory),
  );

  const { result, output } = await captureStdout(() =>
    runCli(
      [
        "import",
        "morning-show",
        "https://music.163.com/playlist?id=6792103822",
      ],
      baseDirectory,
      {
        importPlaylist: async (name, url, directory) => {
          const artifactPath = path.join(
            directory,
            ".vibefm",
            name,
            "playlist.json",
          );
          await writeFile(artifactPath, JSON.stringify({ source: { url } }));
          return {
            workspace: { name, path: path.dirname(artifactPath) },
            path: artifactPath,
            playlistId: "6792103822",
            playlistName: "Morning Music",
            trackCount: 12,
          };
        },
      },
    ),
  );

  const response = JSON.parse(output);
  assert.equal(result, 0);
  assert.equal(response.success, true);
  assert.equal(response.data.action, "import");
  assert.equal(response.data.playlist.trackCount, 12);
  await readFile(
    path.join(baseDirectory, ".vibefm", "morning-show", "playlist.json"),
    "utf8",
  );
});

test("import command requires a workspace and playlist URL", async () => {
  const { result, output } = await captureStdout(() =>
    runCli(["import", "morning-show"]),
  );

  assert.equal(result, 1);
  assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
});

test("generate plan command shows a blocking notice and prints JSON", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const planPath = path.join(
    baseDirectory,
    ".vibefm",
    "morning-show",
    "plan.json",
  );

  const { result, stdout, stderr } = await captureOutput(() =>
    runCli(
      ["generate", "plan", "morning-show", "--count", "2"],
      baseDirectory,
      {
        generatePlan: async (name, count, directory) => {
          assert.equal(name, "morning-show");
          assert.equal(count, 2);
          assert.equal(directory, baseDirectory);
          return {
            workspace: {
              name,
              path: path.join(directory, ".vibefm", name),
            },
            path: planPath,
            trackCount: count,
            theme: "Morning Light",
          } satisfies ProgramPlanResult;
        },
      },
    ),
  );

  assert.equal(result, 0);
  assert.equal(stderr, "AI 正在生成节目策划，请稍候...\n");
  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    data: {
      action: "generate-plan",
      workspace: {
        name: "morning-show",
        path: path.join(baseDirectory, ".vibefm", "morning-show"),
      },
      plan: {
        path: planPath,
        trackCount: 2,
        theme: "Morning Light",
      },
    },
  });
});

test("generate plan command validates count arguments", async () => {
  for (const args of [
    ["generate", "plan", "morning-show"],
    ["generate", "plan", "morning-show", "--count", "0"],
    ["generate", "plan", "morning-show", "--count", "2.5"],
    ["generate", "plan", "morning-show", "--unknown", "2"],
  ]) {
    const { result, output } = await captureStdout(() => runCli(args));
    assert.equal(result, 1);
    assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
  }
});

test("generate script command shows a blocking notice and prints JSON", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const scriptPath = path.join(
    baseDirectory,
    ".vibefm",
    "morning-show",
    "script.md",
  );

  const { result, stdout, stderr } = await captureOutput(() =>
    runCli(
      ["generate", "script", "morning-show"],
      baseDirectory,
      {
        generateScript: async (name, directory) => {
          assert.equal(name, "morning-show");
          assert.equal(directory, baseDirectory);
          return {
            workspace: {
              name,
              path: path.join(directory, ".vibefm", name),
            },
            path: scriptPath,
            trackCount: 2,
            theme: "Morning Light",
            format: "radio-script-dsl",
          } satisfies ProgramScriptResult;
        },
      },
    ),
  );

  assert.equal(result, 0);
  assert.equal(stderr, "AI 正在生成节目文稿，请稍候...\n");
  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    data: {
      action: "generate-script",
      workspace: {
        name: "morning-show",
        path: path.join(baseDirectory, ".vibefm", "morning-show"),
      },
      script: {
        path: scriptPath,
        trackCount: 2,
        theme: "Morning Light",
        format: "radio-script-dsl",
      },
    },
  });
});

test("generate script command rejects extra arguments", async () => {
  for (const args of [
    ["generate", "script"],
    ["generate", "script", "morning-show", "extra"],
  ]) {
    const { result, output } = await captureStdout(() => runCli(args));
    assert.equal(result, 1);
    assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
  }
});

test("generate events command prints the event stream artifact", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const eventsPath = path.join(
    baseDirectory,
    ".vibefm",
    "morning-show",
    "events.json",
  );

  const { result, stdout, stderr } = await captureOutput(() =>
    runCli(
      ["generate", "events", "morning-show"],
      baseDirectory,
      {
        generateEvents: async (name, directory) => {
          assert.equal(name, "morning-show");
          assert.equal(directory, baseDirectory);
          return {
            workspace: {
              name,
              path: path.join(directory, ".vibefm", name),
            },
            path: eventsPath,
            eventCount: 8,
            hostCount: 2,
            playCount: 1,
          } satisfies ProgramEventsResult;
        },
      },
    ),
  );

  assert.equal(result, 0);
  assert.equal(stderr, "");
  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    data: {
      action: "generate-events",
      workspace: {
        name: "morning-show",
        path: path.join(baseDirectory, ".vibefm", "morning-show"),
      },
      events: {
        path: eventsPath,
        eventCount: 8,
        hostCount: 2,
        playCount: 1,
      },
    },
  });
});

test("generate events command rejects extra arguments", async () => {
  for (const args of [
    ["generate", "events"],
    ["generate", "events", "morning-show", "extra"],
  ]) {
    const { result, output } = await captureStdout(() => runCli(args));
    assert.equal(result, 1);
    assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
  }
});

test("generate audio command shows a blocking notice and prints JSON", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const audioPath = path.join(baseDirectory, ".vibefm", "morning-show", "audio");

  const { result, stdout, stderr } = await captureOutput(() =>
    runCli(
      ["generate", "audio", "morning-show"],
      baseDirectory,
      {
        generateAudio: async (name, directory, options) => {
          assert.equal(name, "morning-show");
          assert.equal(directory, baseDirectory);
          assert.equal(options?.quality, "standard");
          return {
            workspace: { name, path: path.join(directory, ".vibefm", name) },
            directory: audioPath,
            manifest: path.join(audioPath, "manifest.json"),
            trackCount: 5,
            downloadedCount: 4,
            placeholderCount: 1,
            warnings: ["Track 123: Download HTTP 403"],
          } satisfies AudioDownloadResult;
        },
      },
    ),
  );

  assert.equal(result, 0);
  assert.ok(stderr.includes("正在下载音频"), "should show progress notice");
  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    data: {
      action: "generate-audio",
      workspace: {
        name: "morning-show",
        path: path.join(baseDirectory, ".vibefm", "morning-show"),
      },
      audio: {
        directory: audioPath,
        manifest: path.join(audioPath, "manifest.json"),
        trackCount: 5,
        downloadedCount: 4,
        placeholderCount: 1,
      },
      warnings: ["Track 123: Download HTTP 403"],
    },
  });
});

test("generate audio command accepts --quality and --force flags", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));

  const { result, stdout } = await captureOutput(() =>
    runCli(
      ["generate", "audio", "morning-show", "--quality", "exhigh", "--force"],
      baseDirectory,
      {
        generateAudio: async (_name, _directory, options) => {
          assert.equal(options?.quality, "exhigh");
          assert.equal(options?.force, true);
          return {
            workspace: { name: "morning-show", path: "" },
            directory: "",
            manifest: "",
            trackCount: 1,
            downloadedCount: 1,
            placeholderCount: 0,
            warnings: [],
          } satisfies AudioDownloadResult;
        },
      },
    ),
  );

  assert.equal(result, 0);
  assert.equal(JSON.parse(stdout).data.audio.downloadedCount, 1);
});

test("generate audio command rejects invalid quality level", async () => {
  const { result, output } = await captureStdout(() =>
    runCli(["generate", "audio", "morning-show", "--quality", "invalid"]),
  );

  assert.equal(result, 1);
  assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
});

test("generate audio command rejects extra arguments", async () => {
  for (const args of [
    ["generate", "audio"],
    ["generate", "audio", "morning-show", "extra"],
  ]) {
    const { result, output } = await captureStdout(() => runCli(args));
    assert.equal(result, 1);
    assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
  }
});

test("generate speech command passes voice options and prints host segment counts", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const speechPath = path.join(baseDirectory, ".vibefm", "morning-show", "speech");

  const { result, stdout, stderr } = await captureOutput(() =>
    runCli(
      ["generate", "speech", "morning-show", "--voice", "茉莉", "--force"],
      baseDirectory,
      {
        generateSpeech: async (name, directory, options) => {
          assert.equal(name, "morning-show");
          assert.equal(directory, baseDirectory);
          assert.equal(options.voice, "茉莉");
          assert.equal(options.force, true);
          return {
            workspace: { name, path: path.join(directory, ".vibefm", name) },
            directory: speechPath,
            manifest: path.join(speechPath, "manifest.json"),
            segmentCount: 3,
            synthesizedCount: 3,
            placeholderCount: 0,
            warnings: [],
          } satisfies SpeechGenerationResult;
        },
      },
    ),
  );

  assert.equal(result, 0);
  assert.match(stderr, /正在将文稿转换为语音/u);
  assert.deepEqual(JSON.parse(stdout).data.speech, {
    directory: speechPath,
    manifest: path.join(speechPath, "manifest.json"),
    segmentCount: 3,
    synthesizedCount: 3,
    placeholderCount: 0,
  });
});

test("generate speech command preserves dependency error codes", async () => {
  const { result, output } = await captureStdout(() =>
    runCli(["generate", "speech", "morning-show"], process.cwd(), {
      generateSpeech: async () => {
        throw new SpeechGenerationError(
          "MISSING_SPEECH_DEPENDENCY",
          "Required speech dependency events.json does not exist.",
        );
      },
    }),
  );

  assert.equal(result, 1);
  assert.deepEqual(JSON.parse(output).error, {
    code: "MISSING_SPEECH_DEPENDENCY",
    message: "Required speech dependency events.json does not exist.",
  });
});

test("generate render command shows progress and prints the output artifact", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  const workspacePath = path.join(baseDirectory, ".vibefm", "morning-show");
  const outputPath = path.join(workspacePath, "output", "program.mp3");
  const manifestPath = path.join(workspacePath, "output", "manifest.json");

  const { result, stdout, stderr } = await captureOutput(() =>
    runCli(["generate", "render", "morning-show"], baseDirectory, {
      generateRender: async (name, directory) => {
        assert.equal(name, "morning-show");
        assert.equal(directory, baseDirectory);
        return {
          workspace: { name, path: workspacePath },
          path: outputPath,
          manifest: manifestPath,
          durationSeconds: 1800.5,
          eventCount: 24,
          inputCount: 12,
        } satisfies ProgramRenderResult;
      },
    }),
  );

  assert.equal(result, 0);
  assert.match(stderr, /正在合成节目/u);
  assert.deepEqual(JSON.parse(stdout), {
    success: true,
    data: {
      action: "generate-render",
      workspace: { name: "morning-show", path: workspacePath },
      render: {
        path: outputPath,
        manifest: manifestPath,
        durationSeconds: 1800.5,
        eventCount: 24,
        inputCount: 12,
      },
    },
  });
});

test("generate render command rejects extra arguments", async () => {
  for (const args of [
    ["generate", "render"],
    ["generate", "render", "morning-show", "extra"],
  ]) {
    const { result, output } = await captureStdout(() => runCli(args));
    assert.equal(result, 1);
    assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
  }
});

test("generate render command preserves render error codes", async () => {
  const { result, output } = await captureStdout(() =>
    runCli(["generate", "render", "morning-show"], process.cwd(), {
      generateRender: async () => {
        throw new ProgramRenderError(
          "MISSING_RENDER_DEPENDENCY",
          "Required render dependency events.json does not exist.",
        );
      },
    }),
  );

  assert.equal(result, 1);
  assert.deepEqual(JSON.parse(output).error, {
    code: "MISSING_RENDER_DEPENDENCY",
    message: "Required render dependency events.json does not exist.",
  });
});

test("status command shows all stages pending for a fresh workspace", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  await captureStdout(() =>
    runCli(["create", "morning-show", "Morning radio"], baseDirectory),
  );

  const { result, output } = await captureStdout(() =>
    runCli(["status", "morning-show"], baseDirectory),
  );

  assert.equal(result, 0);
  const response = JSON.parse(output);
  assert.equal(response.success, true);
  assert.equal(response.data.action, "status");
  assert.equal(response.data.workspace.name, "morning-show");
  assert.deepEqual(response.data.stages, [
    { stage: "playlist", status: "pending" },
    { stage: "plan", status: "pending" },
    { stage: "script", status: "pending" },
    { stage: "events", status: "pending" },
    { stage: "audio", status: "pending" },
    { stage: "speech", status: "pending" },
    { stage: "render", status: "pending" },
  ]);
});

test("status command shows completed stages when files exist", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  await captureStdout(() =>
    runCli(["create", "morning-show", "Morning radio"], baseDirectory),
  );

  const workspaceDir = path.join(baseDirectory, ".vibefm", "morning-show");
  await writeFile(path.join(workspaceDir, "playlist.json"), "{}");
  await writeFile(path.join(workspaceDir, "plan.json"), "{}");
  await mkdir(path.join(workspaceDir, "audio"), { recursive: true });
  await writeFile(path.join(workspaceDir, "audio", "manifest.json"), "{}");

  const { result, output } = await captureStdout(() =>
    runCli(["status", "morning-show"], baseDirectory),
  );

  assert.equal(result, 0);
  assert.deepEqual(JSON.parse(output).data.stages, [
    { stage: "playlist", status: "completed" },
    { stage: "plan", status: "completed" },
    { stage: "script", status: "pending" },
    { stage: "events", status: "pending" },
    { stage: "audio", status: "completed" },
    { stage: "speech", status: "pending" },
    { stage: "render", status: "pending" },
  ]);
});

test("status command shows all completed when all artifacts exist", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));
  await captureStdout(() =>
    runCli(["create", "morning-show", "Morning radio"], baseDirectory),
  );

  const workspaceDir = path.join(baseDirectory, ".vibefm", "morning-show");
  await writeFile(path.join(workspaceDir, "playlist.json"), "{}");
  await writeFile(path.join(workspaceDir, "plan.json"), "{}");
  await writeFile(path.join(workspaceDir, "script.md"), "# Script");
  await writeFile(path.join(workspaceDir, "events.json"), "[]");
  await mkdir(path.join(workspaceDir, "audio"), { recursive: true });
  await writeFile(path.join(workspaceDir, "audio", "manifest.json"), "{}");
  await mkdir(path.join(workspaceDir, "speech"), { recursive: true });
  await writeFile(path.join(workspaceDir, "speech", "manifest.json"), "{}");
  await mkdir(path.join(workspaceDir, "output"), { recursive: true });
  await writeFile(path.join(workspaceDir, "output", "program.mp3"), "");

  const { result, output } = await captureStdout(() =>
    runCli(["status", "morning-show"], baseDirectory),
  );

  assert.equal(result, 0);
  assert.deepEqual(JSON.parse(output).data.stages, [
    { stage: "playlist", status: "completed" },
    { stage: "plan", status: "completed" },
    { stage: "script", status: "completed" },
    { stage: "events", status: "completed" },
    { stage: "audio", status: "completed" },
    { stage: "speech", status: "completed" },
    { stage: "render", status: "completed" },
  ]);
});

test("status command fails when workspace does not exist", async () => {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-cli-"));

  const { result, output } = await captureStdout(() =>
    runCli(["status", "nonexistent"], baseDirectory),
  );

  assert.equal(result, 1);
  assert.equal(JSON.parse(output).error.code, "WORKSPACE_NOT_FOUND");
});

test("status command rejects invalid arguments", async () => {
  for (const args of [["status"], ["status", "morning-show", "extra"]]) {
    const { result, output } = await captureStdout(() => runCli(args));
    assert.equal(result, 1);
    assert.equal(JSON.parse(output).error.code, "INVALID_ARGUMENTS");
  }
});
