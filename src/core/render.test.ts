import assert from "node:assert/strict";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  generateProgramRender,
  ProgramRenderError,
  type FfmpegExecutor,
} from "./render.js";

async function createRenderWorkspace(): Promise<{
  baseDirectory: string;
  workspaceDirectory: string;
}> {
  const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "vibefm-render-"));
  const workspaceDirectory = path.join(baseDirectory, ".vibefm", "test");
  await Promise.all([
    mkdir(path.join(workspaceDirectory, "audio"), { recursive: true }),
    mkdir(path.join(workspaceDirectory, "speech"), { recursive: true }),
    mkdir(path.join(baseDirectory, "assets", "bgm"), { recursive: true }),
    mkdir(path.join(baseDirectory, "assets", "sfx"), { recursive: true }),
  ]);
  await writeFile(
    path.join(workspaceDirectory, "info.json"),
    JSON.stringify({ prompt: "test" }),
  );
  return { baseDirectory, workspaceDirectory };
}

async function writeCompleteDependencies(workspaceDirectory: string): Promise<void> {
  const events = [
    { type: "bgm", action: "start", name: "bed", volume: 0.2, fadeIn: 1 },
    {
      type: "host",
      id: "host-001",
      voiceDesignPrompt: "warm",
      text: "Welcome.",
    },
    { type: "bgm", action: "stop", fadeOut: 1 },
    { type: "transition", transitionType: "fade", duration: 2 },
    { type: "play", id: "123", fadeIn: 1, fadeOut: 2 },
    { type: "pause", duration: 1 },
    { type: "sfx", name: "chime", volume: 0.5 },
  ];
  await Promise.all([
    writeFile(
      path.join(workspaceDirectory, "events.json"),
      JSON.stringify(events, null, 2),
    ),
    writeFile(
      path.join(workspaceDirectory, "speech", "manifest.json"),
      JSON.stringify({
        version: 1,
        segments: [
          {
            id: "host-001",
            status: "synthesized",
            filePath: "host-001.wav",
          },
        ],
      }),
    ),
    writeFile(
      path.join(workspaceDirectory, "audio", "manifest.json"),
      JSON.stringify({
        version: 1,
        tracks: [
          { id: 123, status: "downloaded", filePath: "123.wav" },
        ],
      }),
    ),
    writeFile(path.join(workspaceDirectory, "speech", "host-001.wav"), "host"),
    writeFile(path.join(workspaceDirectory, "audio", "123.wav"), "track"),
  ]);
}

describe("generateProgramRender", () => {
  it("builds an FFmpeg 8 filter graph and atomically writes the program", async () => {
    const { baseDirectory, workspaceDirectory } = await createRenderWorkspace();
    await writeCompleteDependencies(workspaceDirectory);
    await Promise.all([
      writeFile(path.join(baseDirectory, "assets", "bgm", "bed.wav"), "bgm"),
      writeFile(path.join(baseDirectory, "assets", "sfx", "chime.wav"), "sfx"),
    ]);

    let ffmpegArgs: string[] = [];
    let filterGraph = "";
    const executeFfmpeg: FfmpegExecutor = async (args) => {
      ffmpegArgs = args;
      const graphOption = args.indexOf("-/filter_complex");
      assert.notEqual(graphOption, -1);
      filterGraph = await readFile(args[graphOption + 1], "utf8");
      await writeFile(args.at(-1)!, "rendered mp3");
    };

    const result = await generateProgramRender("test", baseDirectory, {
      executeFfmpeg,
      probeDuration: async (filePath) => {
        if (filePath.includes(`${path.sep}output${path.sep}`)) {
          return 15.25;
        }
        if (filePath.endsWith("host-001.wav")) return 4;
        if (filePath.endsWith("123.wav")) return 10;
        if (filePath.endsWith("chime.wav")) return 2;
        throw new Error(`Unexpected probe: ${filePath}`);
      },
      now: () => new Date("2026-06-14T00:00:00.000Z"),
    });

    assert.equal(result.path, path.join(workspaceDirectory, "output", "program.mp3"));
    assert.equal(await readFile(result.path, "utf8"), "rendered mp3");
    assert.equal(result.durationSeconds, 15.25);
    assert.equal(result.eventCount, 7);
    assert.ok(ffmpegArgs.includes("-stream_loop"));
    assert.ok(ffmpegArgs.includes("libmp3lame"));
    assert.match(filterGraph, /aresample=48000/u);
    assert.match(filterGraph, /aformat=sample_fmts=fltp:sample_rates=48000:channel_layouts=stereo/u);
    assert.match(filterGraph, /afade=t=in/u);
    assert.match(filterGraph, /afade=t=out/u);
    assert.match(filterGraph, /acrossfade=d=2/u);
    assert.match(filterGraph, /amix=inputs=2:duration=first/u);
    assert.match(filterGraph, /loudnorm=I=-16:LRA=11:TP=-1\.5/u);

    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    assert.deepEqual(manifest, {
      version: 1,
      generatedAt: "2026-06-14T00:00:00.000Z",
      filePath: "program.mp3",
      durationSeconds: 15.25,
      eventCount: 7,
      inputCount: 4,
      sampleRate: 48000,
      channels: 2,
      codec: "libmp3lame",
      bitrate: "192k",
      loudness: { integrated: -16, range: 11, truePeak: -1.5 },
    });
  });

  it("rejects a missing events dependency before invoking FFmpeg", async () => {
    const { baseDirectory } = await createRenderWorkspace();
    let invoked = false;

    await assert.rejects(
      generateProgramRender("test", baseDirectory, {
        executeFfmpeg: async () => {
          invoked = true;
        },
      }),
      (error: unknown) =>
        error instanceof ProgramRenderError &&
        error.code === "MISSING_RENDER_DEPENDENCY",
    );
    assert.equal(invoked, false);
  });

  it("rejects placeholder source audio as an incomplete dependency", async () => {
    const { baseDirectory, workspaceDirectory } = await createRenderWorkspace();
    await writeCompleteDependencies(workspaceDirectory);
    const manifestPath = path.join(workspaceDirectory, "audio", "manifest.json");
    const manifest = JSON.parse(await readFile(manifestPath, "utf8"));
    manifest.tracks[0].status = "placeholder";
    await writeFile(manifestPath, JSON.stringify(manifest));
    await writeFile(path.join(baseDirectory, "assets", "bgm", "bed.wav"), "bgm");
    await writeFile(path.join(baseDirectory, "assets", "sfx", "chime.wav"), "sfx");

    await assert.rejects(
      generateProgramRender("test", baseDirectory, {
        executeFfmpeg: async () => assert.fail("FFmpeg must not run"),
      }),
      (error: unknown) =>
        error instanceof ProgramRenderError &&
        error.code === "INVALID_RENDER_DEPENDENCY" &&
        /placeholder/u.test(error.message),
    );
  });

  it("rejects a missing named BGM asset", async () => {
    const { baseDirectory, workspaceDirectory } = await createRenderWorkspace();
    await writeCompleteDependencies(workspaceDirectory);
    await writeFile(path.join(baseDirectory, "assets", "sfx", "chime.wav"), "sfx");

    await assert.rejects(
      generateProgramRender("test", baseDirectory, {
        executeFfmpeg: async () => assert.fail("FFmpeg must not run"),
      }),
      (error: unknown) =>
        error instanceof ProgramRenderError &&
        error.code === "MISSING_RENDER_DEPENDENCY" &&
        /bed/u.test(error.message),
    );
  });

  it("keeps the previous program when FFmpeg fails", async () => {
    const { baseDirectory, workspaceDirectory } = await createRenderWorkspace();
    await writeCompleteDependencies(workspaceDirectory);
    await Promise.all([
      writeFile(path.join(baseDirectory, "assets", "bgm", "bed.wav"), "bgm"),
      writeFile(path.join(baseDirectory, "assets", "sfx", "chime.wav"), "sfx"),
      mkdir(path.join(workspaceDirectory, "output"), { recursive: true }),
    ]);
    const outputPath = path.join(workspaceDirectory, "output", "program.mp3");
    await writeFile(outputPath, "old program");

    await assert.rejects(
      generateProgramRender("test", baseDirectory, {
        probeDuration: async (filePath) =>
          filePath.endsWith("host-001.wav") ? 4 : 10,
        executeFfmpeg: async () => {
          throw new ProgramRenderError("RENDER_FAILED", "FFmpeg failed.");
        },
      }),
      (error: unknown) =>
        error instanceof ProgramRenderError && error.code === "RENDER_FAILED",
    );

    assert.equal(await readFile(outputPath, "utf8"), "old program");
    await assert.rejects(access(`${outputPath}.tmp`));
  });
});
