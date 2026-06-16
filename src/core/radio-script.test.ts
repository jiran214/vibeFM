import assert from "node:assert/strict";
import test from "node:test";

import { parseRadioScript, RadioScriptParseError } from "./radio-script.js";

function script(...lines: string[]): string {
  return lines.join("\n");
}

const FRONTMATTER = [
  "---",
  "title: Test Show",
  "voice_design_prompt: Warm and calm",
  "---",
];

test("parseRadioScript accepts valid crossfade between main audio events", () => {
  const text = script(
    ...FRONTMATTER,
    "",
    '<audio source="/audio/1.wav" role="main" volume="100%" />',
    '<crossfade duration="2s" />',
    '<audio source="/audio/2.wav" role="main" volume="100%" />',
  );
  const doc = parseRadioScript(text);
  assert.equal(doc.events.length, 3);
  assert.equal(doc.events[0].type, "audio");
  assert.equal(doc.events[1].type, "crossfade");
  assert.equal(doc.events[2].type, "audio");
});

test("parseRadioScript rejects bed audio start splitting a crossfade", () => {
  const text = script(
    ...FRONTMATTER,
    "",
    '<audio source="/audio/1.wav" role="main" volume="100%" />',
    '<crossfade duration="2s" />',
    '<audio source="/audio/bed.wav" role="bed" volume="20%">',
    "</audio>",
    '<audio source="/audio/2.wav" role="main" volume="100%" />',
  );
  assert.throws(
    () => parseRadioScript(text),
    (error: unknown) =>
      error instanceof RadioScriptParseError &&
      /bed audio.*split.*crossfade/iu.test(error.message),
  );
});

test("parseRadioScript rejects bed audio stop splitting a crossfade", () => {
  const text = script(
    ...FRONTMATTER,
    "",
    '<audio source="/audio/1.wav" role="main" volume="100%" />',
    '<audio source="/audio/bed.wav" role="bed" volume="20%">',
    "<host>",
    "background",
    "</host>",
    "</audio>",
    '<crossfade duration="2s" />',
    '<audio source="/audio/2.wav" role="main" volume="100%" />',
  );
  assert.throws(
    () => parseRadioScript(text),
    (error: unknown) =>
      error instanceof RadioScriptParseError &&
      /bed audio.*split.*crossfade/iu.test(error.message),
  );
});

test("parseRadioScript accepts bed stop before crossfade (not splitting)", () => {
  const text = script(
    ...FRONTMATTER,
    "",
    '<audio source="/audio/bed.wav" role="bed" volume="20%">',
    "<host>",
    "background",
    "</host>",
    "</audio>",
    '<audio source="/audio/1.wav" role="main" volume="100%" />',
    '<crossfade duration="2s" />',
    '<audio source="/audio/2.wav" role="main" volume="100%" />',
  );
  const doc = parseRadioScript(text);
  assert.equal(doc.events.length, 6);
});

test("parseRadioScript allows host between crossfade and next main audio", () => {
  const text = script(
    ...FRONTMATTER,
    "",
    '<audio source="/audio/1.wav" role="main" volume="100%" />',
    '<crossfade duration="2s" />',
    "<host>",
    "Quick comment during transition.",
    "</host>",
    '<audio source="/audio/2.wav" role="main" volume="100%" />',
  );
  const doc = parseRadioScript(text);
  assert.equal(doc.events.length, 4);
  assert.equal(doc.events[0].type, "audio");
  assert.equal(doc.events[1].type, "crossfade");
  assert.equal(doc.events[2].type, "host");
  assert.equal(doc.events[3].type, "audio");
});

test("parseRadioScript allows pause between crossfade and next main audio", () => {
  const text = script(
    ...FRONTMATTER,
    "",
    '<audio source="/audio/1.wav" role="main" volume="100%" />',
    '<crossfade duration="2s" />',
    '<pause duration="1s" />',
    '<audio source="/audio/2.wav" role="main" volume="100%" />',
  );
  const doc = parseRadioScript(text);
  assert.equal(doc.events.length, 4);
  assert.equal(doc.events[2].type, "pause");
});
