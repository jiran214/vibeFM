import assert from "node:assert/strict";
import { access, mkdtemp, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import test from "node:test";

import { createWorkspace } from "./workspaces.js";
import { generateAudio, AudioDownloadError } from "./audio.js";

async function createTempDirectory(): Promise<string> {
  return mkdtemp(path.join(os.tmpdir(), "vibefm-audio-"));
}

function validPlan() {
  return {
    think: "先明亮，再收束。",
    track_ids: [5257138],
  };
}

async function writePlan(
  workspacePath: string,
  plan: unknown = validPlan(),
): Promise<string> {
  const infoPath = path.join(workspacePath, "info.json");
  const existing = JSON.parse(await readFile(infoPath, "utf8"));
  await writeFile(infoPath, JSON.stringify({ ...existing, ...plan }, null, 2));
  return infoPath;
}

// --- Slice 2: weapi encryption ---

test("weapiEncrypt produces params and encSecKey with correct format", async () => {
  const { weapiEncrypt } = await import("./audio.js");

  const result = weapiEncrypt('{"ids":[5257138],"level":"standard","encodeType":"aac"}');

  assert.equal(typeof result.params, "string");
  assert.equal(typeof result.encSecKey, "string");
  assert.ok(result.params.length > 0, "params should not be empty");
  assert.ok(
    /^[0-9a-f]{256}$/u.test(result.encSecKey),
    "encSecKey should be 256-char hex",
  );
});

test("weapiEncrypt produces different params on each call (random secret key)", async () => {
  const { weapiEncrypt } = await import("./audio.js");

  const text = '{"ids":[5257138]}';
  const result1 = weapiEncrypt(text);
  const result2 = weapiEncrypt(text);

  assert.notEqual(result1.params, result2.params);
  assert.notEqual(result1.encSecKey, result2.encSecKey);
});

// --- Slice 3: fetch playback URL ---

test("generateAudio fetches playback URL via weapi endpoint", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());
  const requestedUrls: string[] = [];
  let postedBody: string | undefined;

  const result = await generateAudio("demo", baseDirectory, {
    quality: "standard",
    cookie: "test=cookie",
    fetch: async (input, init) => {
      const url = String(input);
      requestedUrls.push(url);
      if (url.includes("weapi/song/enhance/player/url")) {
        postedBody = typeof init?.body === "string" ? init.body : undefined;
        return Response.json({
          code: 200,
          data: [
            {
              id: 5257138,
              url: "https://example.com/song.m4a",
              br: 128000,
              size: 1024000,
              type: "m4a",
              level: "standard",
              encodeType: "aac",
              time: 240000,
              code: 200,
            },
          ],
        });
      }
      return new Response(Buffer.from("audio"), { status: 200 });
    },
  });

  assert.equal(result.downloadedCount, 1);
  assert.deepEqual(requestedUrls, [
    "https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=",
    "https://example.com/song.m4a",
  ]);
  assert.ok(postedBody, "should POST encrypted body");
  assert.ok(postedBody!.includes("params="), "body should contain params");
  assert.ok(postedBody!.includes("encSecKey="), "body should contain encSecKey");
});

test("generateAudio rejects when playback API returns non-200 code", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());

  await assert.rejects(
    generateAudio("demo", baseDirectory, {
      cookie: "test=cookie",
      fetch: async () => Response.json({ code: 400, data: [] }),
    }),
    (error: unknown) =>
      error instanceof AudioDownloadError &&
      error.code === "PLAYBACK_REQUEST_FAILED",
  );
});

test("generateAudio rejects when playback response has no data", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());

  await assert.rejects(
    generateAudio("demo", baseDirectory, {
      cookie: "test=cookie",
      fetch: async () => Response.json({ code: 200 }),
    }),
    (error: unknown) =>
      error instanceof AudioDownloadError &&
      error.code === "INVALID_PLAYBACK_RESPONSE",
  );
});

test("generateAudio sends quality level in encrypted payload", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());
  let postedBody: string | undefined;

  await generateAudio("demo", baseDirectory, {
    quality: "exhigh",
    cookie: "test=cookie",
    fetch: async (input, init) => {
      if (String(input).includes("weapi/song/enhance/player/url")) {
        postedBody = typeof init?.body === "string" ? init.body : undefined;
        return Response.json({
          code: 200,
          data: [{ id: 5257138, url: "https://example.com/song.m4a", code: 200 }],
        });
      }
      return new Response(Buffer.from("audio"), { status: 200 });
    },
  });

  assert.ok(postedBody);
  const params = new URLSearchParams(postedBody!);
  const encryptedParams = params.get("params");
  assert.ok(encryptedParams, "should have params");
});

// --- Slice 4: download audio files ---

test("generateAudio downloads audio file to audio/<id>", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());
  const audioContent = Buffer.from("fake-audio-data");

  const result = await generateAudio("demo", baseDirectory, {
    cookie: "test=cookie",
    fetch: async (input, init) => {
      const url = String(input);
      if (url.includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [
            {
              id: 5257138,
              url: "https://example.com/song.m4a",
              br: 128000,
              size: audioContent.length,
              type: "m4a",
              level: "standard",
              encodeType: "aac",
              time: 240000,
              code: 200,
            },
          ],
        });
      }
      return new Response(audioContent, { status: 200 });
    },
  });

  assert.equal(result.trackCount, 1);
  assert.equal(result.downloadedCount, 1);
  assert.equal(result.placeholderCount, 0);

  const filePath = path.join(workspace.path, "audio", "5257138.wav");
  const fileContent = await readFile(filePath);
  assert.deepEqual(fileContent, audioContent);
});

test("generateAudio skips tracks with no playback URL", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());

  const result = await generateAudio("demo", baseDirectory, {
    cookie: "test=cookie",
    fetch: async () =>
      Response.json({
        code: 200,
        data: [
          {
            id: 5257138,
            url: null,
            br: 0,
            size: 0,
            type: null,
            level: "standard",
            encodeType: "aac",
            time: 0,
            code: 401,
          },
        ],
      }),
  });

  assert.equal(result.downloadedCount, 0);
  assert.equal(result.warnings.length, 1);
  assert.ok(result.warnings[0].includes("5257138"));
});

// --- Slice 5: silent WAV placeholder for failed tracks ---

test("generateAudio creates 1-second silent WAV placeholder for failed download", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());

  const result = await generateAudio("demo", baseDirectory, {
    cookie: "test=cookie",
    fetch: async (input) => {
      if (String(input).includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [
            {
              id: 5257138,
              url: "https://example.com/song.m4a",
              br: 128000,
              size: 100,
              type: "m4a",
              level: "standard",
              encodeType: "aac",
              time: 240000,
              code: 200,
            },
          ],
        });
      }
      return new Response(null, { status: 403 });
    },
  });

  assert.equal(result.downloadedCount, 0);
  assert.equal(result.placeholderCount, 1);
  assert.equal(result.warnings.length, 1);

  const wavPath = path.join(workspace.path, "audio", "5257138.wav");
  const wav = await readFile(wavPath);
  // WAV header: 44 bytes, then 1 second of silence at 44100 Hz, 16-bit, mono
  assert.ok(wav.length === 44 + 44100 * 2, "should be 1-second 16-bit mono WAV");
  assert.equal(wav.toString("ascii", 0, 4), "RIFF");
  assert.equal(wav.toString("ascii", 8, 12), "WAVE");
});

// --- Slice 6: manifest.json ---

test("generateAudio writes manifest.json with track order and status", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  const plan = validPlan();
  plan.track_ids = [5257138, 5257139];
  await writePlan(workspace.path, plan);

  const result = await generateAudio("demo", baseDirectory, {
    quality: "exhigh",
    cookie: "test=cookie",
    fetch: async (input) => {
      const url = String(input);
      if (url.includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [
            {
              id: 5257138,
              url: "https://example.com/song1.m4a",
              br: 320000,
              size: 5000,
              type: "m4a",
              level: "exhigh",
              encodeType: "aac",
              time: 240000,
              code: 200,
            },
            {
              id: 5257139,
              url: null,
              br: 0,
              size: 0,
              type: null,
              level: "exhigh",
              encodeType: "aac",
              time: 0,
              code: 401,
            },
          ],
        });
      }
      return new Response(Buffer.from("audio-data"), { status: 200 });
    },
  });

  const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
  assert.equal(manifest.version, 1);
  assert.equal(manifest.quality, "exhigh");
  assert.equal(manifest.tracks.length, 2);

  assert.equal(manifest.tracks[0].order, 1);
  assert.equal(manifest.tracks[0].id, 5257138);
  assert.equal(manifest.tracks[0].status, "downloaded");
  assert.equal(manifest.tracks[0].filePath, "5257138.wav");
  assert.equal(manifest.tracks[0].br, 320000);
  assert.equal(manifest.tracks[0].size, 5000);

  assert.equal(manifest.tracks[1].order, 2);
  assert.equal(manifest.tracks[1].id, 5257139);
  assert.equal(manifest.tracks[1].status, "placeholder");
  assert.equal(manifest.tracks[1].filePath, "5257139.wav");
  assert.ok(manifest.tracks[1].error);
});

// --- Slice 7: --force re-download ---

test("generateAudio skips already downloaded files by default", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());

  // First download
  await generateAudio("demo", baseDirectory, {
    cookie: "test=cookie",
    fetch: async (input) => {
      if (String(input).includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [{ id: 5257138, url: "https://example.com/song.m4a", br: 128000, size: 9, type: "m4a", code: 200 }],
        });
      }
      return new Response(Buffer.from("original"), { status: 200 });
    },
  });

  // Second download without --force should not re-fetch
  let fetchCount = 0;
  const result = await generateAudio("demo", baseDirectory, {
    cookie: "test=cookie",
    fetch: async (input) => {
      fetchCount++;
      if (String(input).includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [{ id: 5257138, url: "https://example.com/song.m4a", br: 128000, size: 9, type: "m4a", code: 200 }],
        });
      }
      return new Response(Buffer.from("new-data"), { status: 200 });
    },
  });

  assert.equal(result.downloadedCount, 1);
  assert.equal(fetchCount, 0, "should not fetch when file exists");

  const fileContent = await readFile(path.join(workspace.path, "audio", "5257138.wav"));
  assert.equal(fileContent.toString(), "original");
});

test("generateAudio re-downloads when --force is set", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, validPlan());

  // First download
  await generateAudio("demo", baseDirectory, {
    cookie: "test=cookie",
    fetch: async (input) => {
      if (String(input).includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [{ id: 5257138, url: "https://example.com/song.m4a", br: 128000, size: 9, type: "m4a", code: 200 }],
        });
      }
      return new Response(Buffer.from("original"), { status: 200 });
    },
  });

  // Second download with --force should re-fetch
  const result = await generateAudio("demo", baseDirectory, {
    force: true,
    cookie: "test=cookie",
    fetch: async (input) => {
      if (String(input).includes("weapi/song/enhance/player/url")) {
        return Response.json({
          code: 200,
          data: [{ id: 5257138, url: "https://example.com/song.m4a", br: 128000, size: 8, type: "m4a", code: 200 }],
        });
      }
      return new Response(Buffer.from("new-data"), { status: 200 });
    },
  });

  assert.equal(result.downloadedCount, 1);
  const fileContent = await readFile(path.join(workspace.path, "audio", "5257138.wav"));
  assert.equal(fileContent.toString(), "new-data");
});

// --- Slice 1: plan validation ---

test("generateAudio rejects missing info.json", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await rm(path.join(workspace.path, "info.json"));

  await assert.rejects(
    generateAudio("demo", baseDirectory),
    (error: unknown) =>
      error instanceof AudioDownloadError &&
      error.code === "MISSING_AUDIO_DEPENDENCY",
  );
});

test("generateAudio rejects info.json with empty track_ids", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  const plan = validPlan();
  plan.track_ids = [];
  await writePlan(workspace.path, plan);

  await assert.rejects(
    generateAudio("demo", baseDirectory),
    (error: unknown) =>
      error instanceof AudioDownloadError &&
      error.code === "INVALID_AUDIO_DEPENDENCY",
  );
});

test("generateAudio rejects info.json with duplicate track_ids", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  const plan = validPlan();
  plan.track_ids = [5257138, 5257138];
  await writePlan(workspace.path, plan);

  await assert.rejects(
    generateAudio("demo", baseDirectory),
    (error: unknown) =>
      error instanceof AudioDownloadError &&
      error.code === "INVALID_AUDIO_DEPENDENCY",
  );
});

test("generateAudio rejects info.json missing think or track_ids", async () => {
  const baseDirectory = await createTempDirectory();
  const workspace = await createWorkspace("demo", "test prompt", baseDirectory);
  await writePlan(workspace.path, { prompt: "test", think: "reason" });

  await assert.rejects(
    generateAudio("demo", baseDirectory),
    (error: unknown) =>
      error instanceof AudioDownloadError &&
      error.code === "INVALID_AUDIO_DEPENDENCY",
  );
});
