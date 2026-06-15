export class RadioScriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RadioScriptParseError";
  }
}

export interface RadioScriptFrontmatter {
  title: string;
  voiceDesignPrompt: string;
}

export interface RadioScriptHostEvent {
  type: "host";
  line: number;
  endLine: number;
  text: string;
  voiceDesignPrompt: string;
  duckTo?: number;
  duckFade?: number;
}

export type RadioScriptAudioRole = "main" | "bed" | "effect";

export interface RadioScriptAudioEvent {
  type: "audio";
  line: number;
  source?: string;
  role: RadioScriptAudioRole;
  action?: "start" | "stop";
  start?: number;
  duration?: number;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface RadioScriptPauseEvent {
  type: "pause";
  line: number;
  duration: number;
}

export interface RadioScriptCrossfadeEvent {
  type: "crossfade";
  line: number;
  duration: number;
}

export type RadioScriptEvent =
  | RadioScriptHostEvent
  | RadioScriptAudioEvent
  | RadioScriptPauseEvent
  | RadioScriptCrossfadeEvent;

export interface RadioScriptDocument {
  text: string;
  frontmatter: RadioScriptFrontmatter;
  openingLine?: number;
  endingLine?: number;
  events: RadioScriptEvent[];
  hosts: RadioScriptHostEvent[];
  plays: RadioScriptAudioEvent[];
}

interface ActiveHost {
  line: number;
  content: string[];
  voiceDesignPrompt: string;
  duckTo?: number;
  duckFade?: number;
}

export function parseRadioScript(text: string): RadioScriptDocument {
  const trimmed = text.trim();
  if (trimmed.length === 0) {
    throw new RadioScriptParseError("RadioScript is empty.");
  }
  if (trimmed.includes("```")) {
    throw new RadioScriptParseError(
      "RadioScript must not be wrapped in a Markdown code fence.",
    );
  }

  const lines = trimmed.split(/\r?\n/u);
  const { frontmatter, endLine: frontmatterEndLine } = parseFrontmatter(lines);
  const events: RadioScriptEvent[] = [];
  const hosts: RadioScriptHostEvent[] = [];
  const plays: RadioScriptAudioEvent[] = [];
  let activeHost: ActiveHost | undefined;
  let activeBedLine: number | undefined;
  let openingLine: number | undefined;
  let endingLine: number | undefined;

  for (let index = frontmatterEndLine; index < lines.length; index += 1) {
    const rawLine = lines[index];
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (activeHost !== undefined) {
      if (line === "</host>") {
        const hostText = activeHost.content.join("\n").trim();
        if (hostText.length === 0) {
          throw new RadioScriptParseError(
            `RadioScript host block at line ${activeHost.line} is empty.`,
          );
        }
        const host = compact({
          type: "host" as const,
          line: activeHost.line,
          endLine: lineNumber,
          text: hostText,
          voiceDesignPrompt: activeHost.voiceDesignPrompt,
          duckTo: activeHost.duckTo,
          duckFade: activeHost.duckFade,
        });
        events.push(host);
        hosts.push(host);
        activeHost = undefined;
        continue;
      }
      if (/^<\/?(?:host|audio|pause|crossfade)\b/u.test(line)) {
        throw new RadioScriptParseError(
          `RadioScript contains an event inside a host block at line ${lineNumber}.`,
        );
      }
      activeHost.content.push(rawLine);
      continue;
    }

    if (line === "# Opening") {
      if (openingLine !== undefined) {
        throw new RadioScriptParseError(
          "RadioScript contains multiple Opening sections.",
        );
      }
      openingLine = lineNumber;
      continue;
    }
    if (line === "# Ending") {
      if (endingLine !== undefined) {
        throw new RadioScriptParseError(
          "RadioScript contains multiple Ending sections.",
        );
      }
      endingLine = lineNumber;
      continue;
    }

    if (line.startsWith("<host")) {
      const match = /^<host(?:\s+(.+))?>$/u.exec(line);
      if (match === null) {
        throw invalidEvent("host", lineNumber);
      }
      const attributes = parseAttributes(match[1] ?? "", "host", lineNumber);
      assertAllowedAttributes(
        attributes,
        ["voice_design_prompt", "duck_to", "duck_fade"],
        "host",
        lineNumber,
      );
      const voiceDesignPrompt =
        attributes.get("voice_design_prompt")?.trim() ||
        frontmatter.voiceDesignPrompt;
      activeHost = compact({
        line: lineNumber,
        content: [],
        voiceDesignPrompt,
        duckTo: parseVolume(attributes.get("duck_to"), "host duck_to", lineNumber),
        duckFade: parseDuration(
          attributes.get("duck_fade"),
          "host duck_fade",
          lineNumber,
          true,
        ),
      });
      continue;
    }

    if (line === "</host>") {
      throw new RadioScriptParseError(
        `RadioScript has an unmatched closing host tag at line ${lineNumber}.`,
      );
    }

    if (line.startsWith("<audio")) {
      const selfClosing = line.endsWith("/>");
      const match = selfClosing
        ? /^<audio(?:\s+(.+?))?\s*\/>$/u.exec(line)
        : /^<audio(?:\s+(.+))?>$/u.exec(line);
      if (match === null) {
        throw invalidEvent("audio", lineNumber);
      }
      const audio = parseAudioAttributes(match[1] ?? "", lineNumber);
      if (selfClosing) {
        if (audio.role === "bed") {
          audio.role = "main";
        }
        events.push(audio);
        if (audio.role === "main") {
          plays.push(audio);
        }
      } else {
        if (audio.role !== "bed") {
          throw new RadioScriptParseError(
            `RadioScript paired audio at line ${lineNumber} must use role bed.`,
          );
        }
        if (activeBedLine !== undefined) {
          throw new RadioScriptParseError(
            `RadioScript contains nested bed audio at line ${lineNumber}.`,
          );
        }
        activeBedLine = lineNumber;
        events.push({ ...audio, action: "start" });
      }
      continue;
    }

    if (line === "</audio>") {
      if (activeBedLine === undefined) {
        throw new RadioScriptParseError(
          `RadioScript has an unmatched closing audio tag at line ${lineNumber}.`,
        );
      }
      events.push({
        type: "audio",
        line: lineNumber,
        role: "bed",
        action: "stop",
      });
      activeBedLine = undefined;
      continue;
    }

    if (line.startsWith("<pause")) {
      const attributes = parseSelfClosingTag(line, "pause", lineNumber);
      assertAllowedAttributes(attributes, ["duration"], "pause", lineNumber);
      events.push({
        type: "pause",
        line: lineNumber,
        duration: parseRequiredDuration(
          requiredTextAttribute(attributes, "duration", "pause", lineNumber),
          "pause duration",
          lineNumber,
        ),
      });
      continue;
    }

    if (line.startsWith("<crossfade")) {
      const attributes = parseSelfClosingTag(line, "crossfade", lineNumber);
      assertAllowedAttributes(attributes, ["duration"], "crossfade", lineNumber);
      events.push({
        type: "crossfade",
        line: lineNumber,
        duration: parseRequiredDuration(
          requiredTextAttribute(
            attributes,
            "duration",
            "crossfade",
            lineNumber,
          ),
          "crossfade duration",
          lineNumber,
        ),
      });
      continue;
    }

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("<")) {
      throw new RadioScriptParseError(
        `RadioScript contains an unsupported event at line ${lineNumber}.`,
      );
    }
    throw new RadioScriptParseError(
      `RadioScript contains text outside a host block at line ${lineNumber}.`,
    );
  }

  if (activeHost !== undefined) {
    throw new RadioScriptParseError(
      `RadioScript host block at line ${activeHost.line} is not closed.`,
    );
  }
  if (activeBedLine !== undefined) {
    throw new RadioScriptParseError(
      `RadioScript bed audio at line ${activeBedLine} is not closed.`,
    );
  }
  // Opening/Ending are optional

  return {
    text: `${trimmed}\n`,
    frontmatter,
    openingLine,
    endingLine,
    events,
    hosts,
    plays,
  };
}

function parseFrontmatter(lines: string[]): {
  frontmatter: RadioScriptFrontmatter;
  endLine: number;
} {
  if (lines[0]?.trim() !== "---") {
    throw new RadioScriptParseError(
      "RadioScript must start with frontmatter.",
    );
  }
  const closingIndex = lines.findIndex(
    (line, index) => index > 0 && line.trim() === "---",
  );
  if (closingIndex === -1) {
    throw new RadioScriptParseError("RadioScript frontmatter is not closed.");
  }
  const values = new Map<string, string>();
  for (let index = 1; index < closingIndex; index += 1) {
    const line = lines[index].trim();
    if (line.length === 0) continue;
    const match = /^([a-z_][a-z0-9_-]*):\s*(.+)$/iu.exec(line);
    if (match === null) {
      throw new RadioScriptParseError(
        `RadioScript frontmatter has an invalid field at line ${index + 1}.`,
      );
    }
    const key = match[1].toLowerCase();
    if (!new Set(["title", "voice_design_prompt"]).has(key)) {
      throw new RadioScriptParseError(
        `RadioScript frontmatter has unsupported field ${key}.`,
      );
    }
    if (values.has(key)) {
      throw new RadioScriptParseError(
        `RadioScript frontmatter repeats field ${key}.`,
      );
    }
    values.set(key, match[2].trim());
  }
  const title = values.get("title");
  const voiceDesignPrompt = values.get("voice_design_prompt");
  if (!title || !voiceDesignPrompt) {
    throw new RadioScriptParseError(
      "RadioScript frontmatter requires title and voice_design_prompt.",
    );
  }
  return {
    frontmatter: { title, voiceDesignPrompt },
    endLine: closingIndex + 1,
  };
}

function parseAudioAttributes(
  source: string,
  lineNumber: number,
): RadioScriptAudioEvent {
  const attributes = parseAttributes(source, "audio", lineNumber);
  assertAllowedAttributes(
    attributes,
    ["source", "role", "start", "duration", "volume", "fade_in", "fade_out"],
    "audio",
    lineNumber,
  );
  const role = requiredTextAttribute(
    attributes,
    "role",
    "audio",
    lineNumber,
  );
  if (!(["main", "bed", "effect"] as const).includes(role as RadioScriptAudioRole)) {
    throw new RadioScriptParseError(
      `RadioScript audio event at line ${lineNumber} has unsupported role ${role}.`,
    );
  }
  return compact({
    type: "audio" as const,
    line: lineNumber,
    source: requiredTextAttribute(attributes, "source", "audio", lineNumber),
    role: role as RadioScriptAudioRole,
    start: parseDuration(attributes.get("start"), "audio start", lineNumber, true),
    duration: parseDuration(attributes.get("duration"), "audio duration", lineNumber),
    volume: parseVolume(attributes.get("volume"), "audio volume", lineNumber),
    fadeIn: parseDuration(attributes.get("fade_in"), "audio fade_in", lineNumber, true),
    fadeOut: parseDuration(attributes.get("fade_out"), "audio fade_out", lineNumber, true),
  });
}

function parseSelfClosingTag(
  line: string,
  tag: string,
  lineNumber: number,
): Map<string, string> {
  const match = new RegExp(`^<${tag}(?:\\s+(.+?))?\\s*\\/>$`, "u").exec(line);
  if (match === null) {
    throw invalidEvent(tag, lineNumber);
  }
  return parseAttributes(match[1] ?? "", tag, lineNumber);
}

function parseAttributes(
  source: string,
  event: string,
  lineNumber: number,
): Map<string, string> {
  const attributes = new Map<string, string>();
  const pattern = /([a-z_][a-z0-9_-]*)="([^"\r\n]*)"/giu;
  const remainder = source.replace(pattern, (match, name: string, value: string) => {
    const normalizedName = name.toLowerCase();
    if (attributes.has(normalizedName)) {
      throw new RadioScriptParseError(
        `RadioScript ${event} event at line ${lineNumber} repeats attribute ${normalizedName}.`,
      );
    }
    attributes.set(normalizedName, value);
    return " ".repeat(match.length);
  });
  if (remainder.trim().length > 0) {
    throw new RadioScriptParseError(
      `RadioScript ${event} event at line ${lineNumber} has invalid attributes.`,
    );
  }
  return attributes;
}

function assertAllowedAttributes(
  attributes: Map<string, string>,
  allowed: readonly string[],
  event: string,
  lineNumber: number,
): void {
  for (const name of attributes.keys()) {
    if (!allowed.includes(name)) {
      throw new RadioScriptParseError(
        `RadioScript ${event} event at line ${lineNumber} has unsupported attribute ${name}.`,
      );
    }
  }
}

function requiredTextAttribute(
  attributes: Map<string, string>,
  name: string,
  event: string,
  lineNumber: number,
): string {
  const value = attributes.get(name)?.trim();
  if (!value) {
    throw new RadioScriptParseError(
      `RadioScript ${event} event at line ${lineNumber} requires ${name}.`,
    );
  }
  return value;
}

function parseDuration(
  value: string | undefined,
  field: string,
  lineNumber: number,
  allowZero = false,
): number | undefined {
  return value === undefined
    ? undefined
    : parseRequiredDuration(value, field, lineNumber, allowZero);
}

function parseRequiredDuration(
  value: string,
  field: string,
  lineNumber: number,
  allowZero = false,
): number {
  if (!/^(?:0|[1-9]\d*)(?:\.\d+)?s$/u.test(value)) {
    throw new RadioScriptParseError(
      `RadioScript ${field} at line ${lineNumber} must use seconds such as 1.5s.`,
    );
  }
  const seconds = Number(value.slice(0, -1));
  if ((!allowZero && seconds <= 0) || (allowZero && seconds < 0)) {
    throw new RadioScriptParseError(
      `RadioScript ${field} at line ${lineNumber} must be ${allowZero ? "non-negative" : "positive"}.`,
    );
  }
  return seconds;
}

function parseVolume(
  value: string | undefined,
  field: string,
  lineNumber: number,
): number | undefined {
  if (value === undefined) return undefined;
  const match = /^(0|[1-9]\d?|100)(?:\.\d+)?%$/u.exec(value);
  if (match === null) {
    throw new RadioScriptParseError(
      `RadioScript ${field} at line ${lineNumber} must be a percentage between 0% and 100%.`,
    );
  }
  const percentage = Number(value.slice(0, -1));
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new RadioScriptParseError(
      `RadioScript ${field} at line ${lineNumber} must be a percentage between 0% and 100%.`,
    );
  }
  return percentage / 100;
}

function invalidEvent(event: string, lineNumber: number): RadioScriptParseError {
  return new RadioScriptParseError(
    `RadioScript contains an invalid ${event} event at line ${lineNumber}.`,
  );
}

function compact<T extends object>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, field]) => field !== undefined),
  ) as T;
}
