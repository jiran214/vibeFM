import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { describe, it } from "node:test";

import {
  generateSpeech,
  parseEventsToSpeechSegments,
  SpeechGenerationError,
} from "./speech.js";

function validEvents(): unknown[] {
  return [
    { type: "bgm", action: "start", name: "soft_ambient", volume: 0.25 },
    {
      type: "host",
      id: "host-001",
      voiceDesignPrompt: "Warm and welcoming",
      text: "Welcome to the show.",
    },
    { type: "play", id: "123" },
    {
      type: "host",
      id: "host-002",
      voiceDesignPrompt: "Reflective and calm",
      text: "First track reflection and second track introduction.",
    },
    { type: "play", id: "456" },
    {
      type: "host",
      id: "host-003",
      voiceDesignPrompt: "Gentle and unhurried",
      text: "Thank you for listening.",
    },
  ];
}

describe("parseEventsToSpeechSegments", () => {
  it("extracts host events in event-stream order", () => {
    const segments = parseEventsToSpeechSegments(JSON.stringify(validEvents()));

    assert.deepEqual(
      segments.map(({ id, text, voiceDesignPrompt }) => ({
        id,
        text,
        voiceDesignPrompt,
      })),
      [
        {
          id: "host-001",
          text: "Welcome to the show.",
          voiceDesignPrompt: "Warm and welcoming",
        },
        {
          id: "host-002",
          text: "First track reflection and second track introduction.",
          voiceDesignPrompt: "Reflective and calm",
        },
        {
          id: "host-003",
          text: "Thank you for listening.",
          voiceDesignPrompt: "Gentle and unhurried",
        },
      ],
    );
  });

  it("uses host ids as WAV file names", () => {
    const segments = parseEventsToSpeechSegments(JSON.stringify(validEvents()));

    assert.deepEqual(
      segments.map((segment) => segment.fileName),
      ["host-001.wav", "host-002.wav", "host-003.wav"],
    );
  });

  it("rejects invalid JSON", () => {
    assert.throws(
      () => parseEventsToSpeechSegments("not json"),
      (error: unknown) =>
        error instanceof SpeechGenerationError &&
        error.code === "INVALID_SPEECH_DEPENDENCY",
    );
  });

  it("rejects an event stream without host events", () => {
    assert.throws(
      () => parseEventsToSpeechSegments('[{"type":"play","id":"123"}]'),
      (error: unknown) =>
        error instanceof SpeechGenerationError &&
        error.code === "INVALID_SPEECH_DEPENDENCY",
    );
  });

  it("rejects incomplete host events", () => {
    const events = validEvents();
    events[1] = { type: "host", id: "host-001", text: "Welcome." };

    assert.throws(
      () => parseEventsToSpeechSegments(JSON.stringify(events)),
      (error: unknown) =>
        error instanceof SpeechGenerationError &&
        error.code === "INVALID_SPEECH_DEPENDENCY",
    );
  });

  it("rejects duplicate host ids", () => {
    const events = validEvents();
    events[3] = { ...events[3] as object, id: "host-001" };

    assert.throws(
      () => parseEventsToSpeechSegments(JSON.stringify(events)),
      (error: unknown) =>
        error instanceof SpeechGenerationError &&
        error.code === "INVALID_SPEECH_DEPENDENCY",
    );
  });

  it("rejects incomplete non-host events before synthesis", () => {
    const events = validEvents();
    events[2] = { type: "play" };

    assert.throws(
      () => parseEventsToSpeechSegments(JSON.stringify(events)),
      (error: unknown) =>
        error instanceof SpeechGenerationError &&
        error.code === "INVALID_SPEECH_DEPENDENCY",
    );
  });
});

describe("generateSpeech", () => {
  async function createTestWorkspace(): Promise<{
    baseDirectory: string;
    workspaceDirectory: string;
  }> {
    const baseDirectory = await mkdtemp(path.join(os.tmpdir(), "speech-test-"));
    const workspaceDirectory = path.join(baseDirectory, ".vibefm", "test");
    await mkdir(workspaceDirectory, { recursive: true });
    return { baseDirectory, workspaceDirectory };
  }

  async function writeEvents(workspaceDirectory: string): Promise<void> {
    await writeFile(
      path.join(workspaceDirectory, "events.json"),
      JSON.stringify(validEvents(), null, 2),
    );
  }

  it("creates one WAV file for each host event", async () => {
    const { baseDirectory, workspaceDirectory } = await createTestWorkspace();
    await writeEvents(workspaceDirectory);

    const calls: string[] = [];
    const result = await generateSpeech("test", baseDirectory, {
      synthesizeSpeech: async (text) => {
        calls.push(text);
        return {
          audioData: Buffer.from(text).toString("base64"),
          format: "wav" as const,
        };
      },
    });

    assert.equal(result.segmentCount, 3);
    assert.equal(result.synthesizedCount, 3);
    assert.equal(result.placeholderCount, 0);
    assert.deepEqual(calls, [
      "Welcome to the show.",
      "First track reflection and second track introduction.",
      "Thank you for listening.",
    ]);
    assert.deepEqual(
      await Promise.all(
        ["host-001.wav", "host-002.wav", "host-003.wav"].map((fileName) =>
          readFile(path.join(result.directory, fileName), "utf8"),
        ),
      ),
      calls,
    );
  });

  it("writes manifest.json with host ids and segment status", async () => {
    const { baseDirectory, workspaceDirectory } = await createTestWorkspace();
    await writeEvents(workspaceDirectory);

    const result = await generateSpeech("test", baseDirectory, {
      synthesizeSpeech: async (text) => ({
        audioData: Buffer.from(text).toString("base64"),
        format: "wav" as const,
      }),
      now: () => new Date("2026-01-01T00:00:00.000Z"),
    });

    const manifest = JSON.parse(await readFile(result.manifest, "utf8"));
    assert.equal(manifest.version, 1);
    assert.equal(manifest.voice, "冰糖");
    assert.equal(manifest.segments.length, 3);
    assert.deepEqual(
      manifest.segments.map(
        (segment: { id: string; filePath: string; status: string }) => ({
          id: segment.id,
          filePath: segment.filePath,
          status: segment.status,
        }),
      ),
      [
        { id: "host-001", filePath: "host-001.wav", status: "synthesized" },
        { id: "host-002", filePath: "host-002.wav", status: "synthesized" },
        { id: "host-003", filePath: "host-003.wav", status: "synthesized" },
      ],
    );
  });

  it("passes each voice_design_prompt to TTS as the style instruction", async () => {
    const { baseDirectory, workspaceDirectory } = await createTestWorkspace();
    await writeEvents(workspaceDirectory);

    const receivedPrompts: Array<string | undefined> = [];
    await generateSpeech("test", baseDirectory, {
      voice: "茉莉",
      synthesizeSpeech: async (
        text,
        voice,
        options,
      ) => {
        assert.equal(voice, "茉莉");
        receivedPrompts.push(options?.voiceDesignPrompt);
        return {
          audioData: Buffer.from(text).toString("base64"),
          format: "wav" as const,
        };
      },
    });

    assert.deepEqual(receivedPrompts, [
      "Warm and welcoming",
      "Reflective and calm",
      "Gentle and unhurried",
    ]);
  });

  it("creates a silent WAV placeholder on TTS failure", async () => {
    const { baseDirectory, workspaceDirectory } = await createTestWorkspace();
    await writeEvents(workspaceDirectory);

    let callCount = 0;
    const result = await generateSpeech("test", baseDirectory, {
      synthesizeSpeech: async () => {
        callCount += 1;
        if (callCount === 2) {
          throw new Error("TTS failed");
        }
        return {
          audioData: Buffer.from("ok").toString("base64"),
          format: "wav" as const,
        };
      },
    });

    assert.equal(result.synthesizedCount, 2);
    assert.equal(result.placeholderCount, 1);
    assert.equal(result.warnings.length, 1);
    assert.match(result.warnings[0], /host-002.*TTS failed/u);
  });

  it("skips existing host audio unless force is enabled", async () => {
    const { baseDirectory, workspaceDirectory } = await createTestWorkspace();
    await writeEvents(workspaceDirectory);

    let callCount = 0;
    const synthesizeSpeech = async (text: string) => {
      callCount += 1;
      return {
        audioData: Buffer.from(text).toString("base64"),
        format: "wav" as const,
      };
    };

    await generateSpeech("test", baseDirectory, { synthesizeSpeech });
    await generateSpeech("test", baseDirectory, { synthesizeSpeech });
    assert.equal(callCount, 3);

    await generateSpeech("test", baseDirectory, {
      synthesizeSpeech,
      force: true,
    });
    assert.equal(callCount, 6);
  });

  it("does not require script.md once events.json exists", async () => {
    const { baseDirectory, workspaceDirectory } = await createTestWorkspace();
    await writeEvents(workspaceDirectory);

    const result = await generateSpeech("test", baseDirectory, {
      synthesizeSpeech: async (text) => ({
        audioData: Buffer.from(text).toString("base64"),
        format: "wav" as const,
      }),
    });

    assert.equal(result.segmentCount, 3);
  });

  it("rejects missing events.json", async () => {
    const { baseDirectory } = await createTestWorkspace();

    await assert.rejects(
      () => generateSpeech("test", baseDirectory),
      (error: unknown) =>
        error instanceof SpeechGenerationError &&
        error.code === "MISSING_SPEECH_DEPENDENCY",
    );
  });
});
