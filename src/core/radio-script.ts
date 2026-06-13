export class RadioScriptParseError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RadioScriptParseError";
  }
}

export interface RadioScriptHostEvent {
  type: "host";
  line: number;
  endLine: number;
  text: string;
  voiceDesignPrompt: string;
}

export interface RadioScriptPlayEvent {
  type: "play";
  line: number;
  id: string;
  fadeIn?: number;
  fadeOut?: number;
}

export interface RadioScriptBgmStartEvent {
  type: "bgm";
  line: number;
  action: "start";
  name: string;
  volume?: number;
  fadeIn?: number;
  fadeOut?: number;
}

export interface RadioScriptBgmStopEvent {
  type: "bgm";
  line: number;
  action: "stop";
  fadeOut?: number;
}

export interface RadioScriptSfxEvent {
  type: "sfx";
  line: number;
  name: string;
  volume?: number;
}

export interface RadioScriptPauseEvent {
  type: "pause";
  line: number;
  duration: number;
}

export interface RadioScriptTransitionEvent {
  type: "transition";
  line: number;
  transitionType: "soft" | "fade" | "radio" | "whoosh" | "silence" | "cut";
  duration: number;
}

export type RadioScriptEvent =
  | RadioScriptHostEvent
  | RadioScriptPlayEvent
  | RadioScriptBgmStartEvent
  | RadioScriptBgmStopEvent
  | RadioScriptSfxEvent
  | RadioScriptPauseEvent
  | RadioScriptTransitionEvent;

export interface RadioScriptDocument {
  text: string;
  openingLine: number;
  endingLine: number;
  events: RadioScriptEvent[];
  hosts: RadioScriptHostEvent[];
  plays: RadioScriptPlayEvent[];
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
  if (/\[\[PLAY:/u.test(trimmed)) {
    throw new RadioScriptParseError(
      "RadioScript uses the legacy play marker instead of a play event.",
    );
  }

  const lines = trimmed.split(/\r?\n/u);
  const events: RadioScriptEvent[] = [];
  const hosts: RadioScriptHostEvent[] = [];
  const plays: RadioScriptPlayEvent[] = [];
  let activeHost:
    | {
        line: number;
        content: string[];
        voiceDesignPrompt: string;
      }
    | undefined;
  let openingLine: number | undefined;
  let endingLine: number | undefined;

  for (const [index, rawLine] of lines.entries()) {
    const lineNumber = index + 1;
    const line = rawLine.trim();

    if (line === "# Opening") {
      if (openingLine !== undefined) {
        throw new RadioScriptParseError(
          "RadioScript contains multiple Opening sections.",
        );
      }
      openingLine = lineNumber;
    }
    if (line === "# Ending") {
      if (endingLine !== undefined) {
        throw new RadioScriptParseError(
          "RadioScript contains multiple Ending sections.",
        );
      }
      endingLine = lineNumber;
    }

    if (line.startsWith("[host")) {
      if (activeHost !== undefined) {
        throw new RadioScriptParseError(
          "RadioScript contains nested host blocks.",
        );
      }
      const match = /^\[host(?:\s+(.+))?\]$/u.exec(line);
      if (match === null) {
        throw new RadioScriptParseError(
          `RadioScript contains an invalid host event at line ${lineNumber}.`,
        );
      }
      const attributes = parseAttributes(match[1] ?? "", "host", lineNumber);
      assertAllowedAttributes(attributes, ["voice_design_prompt"], "host", lineNumber);
      const voiceDesignPrompt = attributes.get("voice_design_prompt")?.trim();
      if (voiceDesignPrompt === undefined || voiceDesignPrompt.length === 0) {
        throw new RadioScriptParseError(
          `RadioScript host event at line ${lineNumber} requires voice_design_prompt.`,
        );
      }
      activeHost = { line: lineNumber, content: [], voiceDesignPrompt };
      continue;
    }

    if (line === "[/host]") {
      if (activeHost === undefined) {
        throw new RadioScriptParseError(
          `RadioScript has an unmatched closing host tag at line ${lineNumber}.`,
        );
      }
      const hostText = activeHost.content.join("\n").trim();
      if (hostText.length === 0) {
        throw new RadioScriptParseError(
          `RadioScript host block at line ${activeHost.line} is empty.`,
        );
      }
      const host: RadioScriptHostEvent = {
        type: "host",
        line: activeHost.line,
        endLine: lineNumber,
        text: hostText,
        voiceDesignPrompt: activeHost.voiceDesignPrompt,
      };
      events.push(host);
      hosts.push(host);
      activeHost = undefined;
      continue;
    }

    if (line.startsWith("[play")) {
      if (activeHost !== undefined) {
        throw new RadioScriptParseError(
          `RadioScript contains a play event inside a host block at line ${lineNumber}.`,
        );
      }
      const match = /^\[play(?:\s+(.+))?\]$/u.exec(line);
      if (match === null) {
        throw new RadioScriptParseError(
          `RadioScript contains an invalid play event at line ${lineNumber}.`,
        );
      }
      const attributes = parseAttributes(match[1] ?? "", "play", lineNumber);
      assertAllowedAttributes(
        attributes,
        ["id", "fade_in", "fade_out"],
        "play",
        lineNumber,
      );
      const id = attributes.get("id");
      if (id === undefined || !/^\d+$/u.test(id)) {
        throw new RadioScriptParseError(
          `RadioScript play event at line ${lineNumber} requires a numeric id.`,
        );
      }
      const play: RadioScriptPlayEvent = {
        type: "play",
        line: lineNumber,
        id,
        ...optionalNumber(
          "fadeIn",
          parseDuration(attributes.get("fade_in"), "play fade_in", lineNumber),
        ),
        ...optionalNumber(
          "fadeOut",
          parseDuration(attributes.get("fade_out"), "play fade_out", lineNumber),
        ),
      };
      events.push(play);
      plays.push(play);
      continue;
    }

    if (activeHost !== undefined) {
      activeHost.content.push(rawLine);
      continue;
    }

    if (line.startsWith("[bgm")) {
      const match = /^\[bgm(?:\s+(.+))?\]$/u.exec(line);
      if (match === null) {
        throw invalidEvent("bgm", lineNumber);
      }
      const source = match[1] ?? "";
      if (/^stop(?:\s|$)/u.test(source)) {
        const attributes = parseAttributes(
          source.replace(/^stop(?:\s+|$)/u, ""),
          "bgm stop",
          lineNumber,
        );
        assertAllowedAttributes(attributes, ["fade_out"], "bgm stop", lineNumber);
        events.push({
          type: "bgm",
          line: lineNumber,
          action: "stop",
          ...optionalNumber(
            "fadeOut",
            parseDuration(attributes.get("fade_out"), "bgm fade_out", lineNumber),
          ),
        });
        continue;
      }

      const attributes = parseAttributes(source, "bgm", lineNumber);
      assertAllowedAttributes(
        attributes,
        ["name", "volume", "fade_in", "fade_out"],
        "bgm",
        lineNumber,
      );
      events.push({
        type: "bgm",
        line: lineNumber,
        action: "start",
        name: requiredTextAttribute(attributes, "name", "bgm", lineNumber),
        ...optionalNumber(
          "volume",
          parseVolume(attributes.get("volume"), "bgm", lineNumber),
        ),
        ...optionalNumber(
          "fadeIn",
          parseDuration(attributes.get("fade_in"), "bgm fade_in", lineNumber),
        ),
        ...optionalNumber(
          "fadeOut",
          parseDuration(attributes.get("fade_out"), "bgm fade_out", lineNumber),
        ),
      });
      continue;
    }

    if (line.startsWith("[sfx")) {
      const match = /^\[sfx(?:\s+(.+))?\]$/u.exec(line);
      if (match === null) {
        throw invalidEvent("sfx", lineNumber);
      }
      const attributes = parseAttributes(match[1] ?? "", "sfx", lineNumber);
      assertAllowedAttributes(attributes, ["name", "volume"], "sfx", lineNumber);
      events.push({
        type: "sfx",
        line: lineNumber,
        name: requiredTextAttribute(attributes, "name", "sfx", lineNumber),
        ...optionalNumber(
          "volume",
          parseVolume(attributes.get("volume"), "sfx", lineNumber),
        ),
      });
      continue;
    }

    if (line.startsWith("[pause")) {
      const match = /^\[pause\s+([^\]]+)\]$/u.exec(line);
      if (match === null) {
        throw invalidEvent("pause", lineNumber);
      }
      events.push({
        type: "pause",
        line: lineNumber,
        duration: parseRequiredDuration(match[1].trim(), "pause", lineNumber),
      });
      continue;
    }

    if (line.startsWith("[transition")) {
      const match = /^\[transition(?:\s+(.+))?\]$/u.exec(line);
      if (match === null) {
        throw invalidEvent("transition", lineNumber);
      }
      const attributes = parseAttributes(
        match[1] ?? "",
        "transition",
        lineNumber,
      );
      assertAllowedAttributes(
        attributes,
        ["type", "duration"],
        "transition",
        lineNumber,
      );
      const transitionType = requiredTextAttribute(
        attributes,
        "type",
        "transition",
        lineNumber,
      );
      if (!TRANSITION_TYPES.includes(transitionType as TransitionType)) {
        throw new RadioScriptParseError(
          `RadioScript transition event at line ${lineNumber} has unsupported type ${transitionType}.`,
        );
      }
      events.push({
        type: "transition",
        line: lineNumber,
        transitionType: transitionType as TransitionType,
        duration: parseRequiredDuration(
          requiredTextAttribute(
            attributes,
            "duration",
            "transition",
            lineNumber,
          ),
          "transition duration",
          lineNumber,
        ),
      });
      continue;
    }

    if (line.length === 0 || line.startsWith("#")) {
      continue;
    }
    if (line.startsWith("[")) {
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
  if (openingLine === undefined || endingLine === undefined) {
    throw new RadioScriptParseError(
      "RadioScript must contain # Opening and # Ending sections.",
    );
  }

  return {
    text: `${trimmed}\n`,
    openingLine,
    endingLine,
    events,
    hosts,
    plays,
  };
}

type TransitionType = RadioScriptTransitionEvent["transitionType"];

const TRANSITION_TYPES: readonly TransitionType[] = [
  "soft",
  "fade",
  "radio",
  "whoosh",
  "silence",
  "cut",
];

function invalidEvent(event: string, lineNumber: number): RadioScriptParseError {
  return new RadioScriptParseError(
    `RadioScript contains an invalid ${event} event at line ${lineNumber}.`,
  );
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
  if (value === undefined || value.length === 0) {
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
): number | undefined {
  return value === undefined
    ? undefined
    : parseRequiredDuration(value, field, lineNumber, true);
}

function parseRequiredDuration(
  value: string,
  field: string,
  lineNumber: number,
  allowZero = false,
): number {
  const match = /^(0|[1-9]\d*)(?:\.(\d+))?s$/u.exec(value);
  if (match === null) {
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
  event: string,
  lineNumber: number,
): number | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (!/^(?:0|[1-9]\d?|100)(?:\.\d+)?$/u.test(value)) {
    throw new RadioScriptParseError(
      `RadioScript ${event} volume at line ${lineNumber} must be between 0 and 100.`,
    );
  }
  const percentage = Number(value);
  if (!Number.isFinite(percentage) || percentage < 0 || percentage > 100) {
    throw new RadioScriptParseError(
      `RadioScript ${event} volume at line ${lineNumber} must be between 0 and 100.`,
    );
  }
  return percentage / 100;
}

function optionalNumber<Key extends string>(
  key: Key,
  value: number | undefined,
): { [Property in Key]?: number } {
  return value === undefined ? {} : ({ [key]: value } as { [Property in Key]: number });
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
