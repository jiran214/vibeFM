import { createCipheriv } from "node:crypto";
import { access, mkdir, readFile, rename, rm, writeFile } from "node:fs/promises";
import path from "node:path";

import { readCookie } from "./cookie.js";
import { getWorkspace, type Workspace } from "./workspaces.js";

const INFO_FILE = "info.json";

export type AudioDownloadErrorCode =
  | "MISSING_AUDIO_DEPENDENCY"
  | "INVALID_AUDIO_DEPENDENCY"
  | "PLAYBACK_REQUEST_FAILED"
  | "INVALID_PLAYBACK_RESPONSE";

export class AudioDownloadError extends Error {
  constructor(
    public readonly code: AudioDownloadErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "AudioDownloadError";
  }
}

export interface AudioDownloadResult {
  workspace: Workspace;
  directory: string;
  manifest: string;
  trackCount: number;
  downloadedCount: number;
  placeholderCount: number;
  warnings: string[];
}

type JsonId = string | number;

interface PlanTrack {
  order: number;
  id: JsonId;
}

interface PlanInput {
  tracks: PlanTrack[];
}

interface JsonObject {
  [key: string]: unknown;
}

export interface GenerateAudioOptions {
  quality?: string;
  force?: boolean;
  cookie?: string;
  fetch?: typeof fetch;
  now?: () => Date;
  writeNotice?: (message: string) => void;
}

const VALID_QUALITY_LEVELS = [
  "standard",
  "exhigh",
  "lossless",
  "hires",
  "jyeffect",
  "jymaster",
  "sky",
  "immersive",
] as const;

// weapi encryption constants
const WEAPI_IV = Buffer.from("0102030405060708");
const WEAPI_PRESET_KEY = Buffer.from("0CoJUm6Qyw8W8jud");
const WEAPI_PUBLIC_KEY = BigInt("0x010001");
const WEAPI_MODULUS = BigInt(
  "0x00e0b509f6259df8642dbc35662901477df22677ec152b5ff68ace615bb7b725152b3ab17a876aea8a5aa76d2e417629ec4ee341f56135fccf695280104e0312ecbda92557c93870114af6c9d05c4f7f0c3685b7a46bee255932575cce10b424d813cfe4875d3e82047b97ddef52741d546b8e289dc6935b3ece0462db0a22b8e7",
);

function pkcs7Pad(text: string): Buffer {
  const buf = Buffer.from(text, "utf8");
  const blockSize = 16;
  const padLen = blockSize - (buf.length % blockSize);
  const padded = Buffer.alloc(buf.length + padLen, padLen);
  buf.copy(padded);
  return padded;
}

function aesCbcEncrypt(text: string, key: Buffer): string {
  const cipher = createCipheriv("aes-128-cbc", key, WEAPI_IV);
  const encrypted = Buffer.concat([cipher.update(pkcs7Pad(text)), cipher.final()]);
  return encrypted.toString("base64");
}

function rsaEncrypt(text: string): string {
  const reversed = text.split("").reverse().join("");
  const hex = Buffer.from(reversed, "utf8").toString("hex");
  const bi = BigInt(`0x${hex}`);
  const encrypted = modPow(bi, WEAPI_PUBLIC_KEY, WEAPI_MODULUS);
  return encrypted.toString(16).padStart(256, "0");
}

function modPow(base: bigint, exp: bigint, mod: bigint): bigint {
  let result = 1n;
  base = base % mod;
  while (exp > 0n) {
    if (exp % 2n === 1n) {
      result = (result * base) % mod;
    }
    exp = exp / 2n;
    base = (base * base) % mod;
  }
  return result;
}

export interface WeapiEncryptedParams {
  params: string;
  encSecKey: string;
}

export function weapiEncrypt(text: string): WeapiEncryptedParams {
  const chars = "abcdefghijklmnopqrstuvwxyz0123456789";
  let secretKey = "";
  for (let i = 0; i < 16; i++) {
    secretKey += chars[Math.floor(Math.random() * chars.length)];
  }

  const firstEncrypt = aesCbcEncrypt(text, WEAPI_PRESET_KEY);
  const secondEncrypt = aesCbcEncrypt(firstEncrypt, Buffer.from(secretKey));
  const encSecKey = rsaEncrypt(secretKey);

  return { params: secondEncrypt, encSecKey };
}

export async function generateAudio(
  workspaceName: string,
  baseDirectory = process.cwd(),
  options: GenerateAudioOptions = {},
): Promise<AudioDownloadResult> {
  const workspace = await getWorkspace(workspaceName, baseDirectory);
  const rawPlan = await readPlan(workspace.path);
  const plan = validatePlan(rawPlan);

  const quality = options.quality ?? "standard";
  const fetchImpl = options.fetch ?? fetch;
  const audioDirectory = path.join(workspace.path, "audio");
  await mkdir(audioDirectory, { recursive: true });

  interface TrackResult {
    id: string;
    status: "downloaded" | "failed";
    filePath: string;
    br?: number;
    size?: number;
    type?: string;
    error?: string;
  }

  const results: TrackResult[] = [];

  // Check which tracks need downloading
  const tracksToFetch: Array<{ trackId: string; order: number }> = [];
  for (const track of plan.tracks) {
    const trackId = String(track.id);
    const wavFileName = `${trackId}.wav`;
    if (!options.force) {
      // Check both new (.wav) and legacy (no extension) file names
      const existingPath = path.join(audioDirectory, wavFileName);
      const legacyPath = path.join(audioDirectory, trackId);
      if (await fileExists(existingPath)) {
        results.push({ id: trackId, status: "downloaded", filePath: wavFileName });
        continue;
      }
      if (await fileExists(legacyPath)) {
        results.push({ id: trackId, status: "downloaded", filePath: trackId });
        continue;
      }
    }
    tracksToFetch.push({ trackId, order: track.order });
  }

  // If all tracks exist, skip API call
  if (tracksToFetch.length === 0) {
    const manifestPath = path.join(audioDirectory, "manifest.json");
    const manifestData = {
      version: 1,
      generatedAt: (options.now ?? (() => new Date()))().toISOString(),
      quality,
      tracks: plan.tracks.map((track) => {
        const result = results.find((r) => r.id === String(track.id));
        return {
          order: track.order,
          id: track.id,
          status: result?.status ?? "missing",
          filePath: result?.filePath,
        };
      }),
    };
    await writeJsonAtomically(manifestPath, manifestData);

    return {
      workspace,
      directory: audioDirectory,
      manifest: manifestPath,
      trackCount: plan.tracks.length,
      downloadedCount: results.filter((r) => r.status === "downloaded").length,
      placeholderCount: results.filter((r) => r.status === "placeholder").length,
      warnings: [],
    };
  }

  // Fetch playback URLs from NetEase API
  const cookie = options.cookie ?? await readCookie(baseDirectory);
  const csrfToken = cookie?.match(/__csrf=([^;]+)/u)?.[1] ?? "";
  const playbackUrl = `https://music.163.com/weapi/song/enhance/player/url/v1?csrf_token=${csrfToken}`;

  const data = JSON.stringify({
    ids: tracksToFetch.map((t) => Number(t.trackId)),
    level: quality,
    encodeType: "aac",
    csrf_token: csrfToken,
  });
  const encrypted = weapiEncrypt(data);

  const body = new URLSearchParams({
    params: encrypted.params,
    encSecKey: encrypted.encSecKey,
  }).toString();

  const headers: Record<string, string> = {
    "Content-Type": "application/x-www-form-urlencoded",
    Referer: "https://music.163.com/",
    "User-Agent":
      "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 vibeFM/0.1",
    Accept: "application/json, text/plain, */*",
    Origin: "https://music.163.com",
  };
  if (cookie) {
    headers.Cookie = cookie;
  }

  const response = await fetchImpl(playbackUrl, {
    method: "POST",
    headers,
    body,
    signal: AbortSignal.timeout(15_000),
  });

  if (!response.ok) {
    throw new AudioDownloadError(
      "PLAYBACK_REQUEST_FAILED",
      `NetEase playback request failed with HTTP ${response.status}.`,
    );
  }

  const payload = await response.json();
  const root = asObject(payload);
  const code = asNumber(root?.code);
  if (code !== 200) {
    throw new AudioDownloadError(
      "PLAYBACK_REQUEST_FAILED",
      `NetEase playback request returned API code ${code ?? "unknown"}. Response: ${JSON.stringify(payload)}`,
    );
  }

  const dataArray = asArray(root?.data);
  if (dataArray === undefined || dataArray.length === 0) {
    throw new AudioDownloadError(
      "INVALID_PLAYBACK_RESPONSE",
      `NetEase playback response is missing data. Response: ${JSON.stringify(payload)}`,
    );
  }

  // Download each track
  for (const item of dataArray) {
    const itemObj = asObject(item);
    const id = itemObj?.id;
    const url = asString(itemObj?.url);
    const itemCode = asNumber(itemObj?.code);
    const br = asNumber(itemObj?.br);
    const size = asNumber(itemObj?.size);
    const type = asString(itemObj?.type);

    if (id === undefined) {
      continue;
    }

    const trackId = String(id);

    if (itemCode !== 200 || url === undefined || url === "") {
      results.push({ id: trackId, status: "failed", filePath: `${trackId}.wav`, error: `Playback code ${itemCode ?? "unknown"}. Response: ${JSON.stringify(item)}` });
      continue;
    }

    const wavFileName = `${trackId}.wav`;
    const filePath = path.join(audioDirectory, wavFileName);
    const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;

    try {
      const downloadHeaders: Record<string, string> = {};
      if (cookie) {
        downloadHeaders.Cookie = cookie;
      }
      const audioResponse = await fetchImpl(url, {
        headers: downloadHeaders,
        signal: AbortSignal.timeout(15_000),
      });
      if (!audioResponse.ok) {
        results.push({ id: trackId, status: "failed", filePath: `${trackId}.wav`, br, size, type, error: `Download HTTP ${audioResponse.status}. URL: ${url}` });
        continue;
      }

      const buffer = Buffer.from(await audioResponse.arrayBuffer());
      await writeFile(tempPath, buffer, { flag: "wx" });
      await rename(tempPath, filePath);
      results.push({ id: trackId, status: "downloaded", filePath: wavFileName, br, size, type });
    } catch (error) {
      results.push({ id: trackId, status: "failed", filePath: `${trackId}.wav`, br, size, type, error: `${getErrorMessage(error)}. URL: ${url}` });
    } finally {
      await rm(tempPath, { force: true });
    }
  }

  const downloaded = results.filter((r) => r.status === "downloaded");
  const failed = results.filter((r) => r.status === "failed");

  // Write manifest.json with current progress
  const manifestPath = path.join(audioDirectory, "manifest.json");
  const manifestData = {
    version: 1,
    generatedAt: (options.now ?? (() => new Date()))().toISOString(),
    quality,
    tracks: plan.tracks.map((track) => {
      const result = results.find((r) => r.id === String(track.id));
      return {
        order: track.order,
        id: track.id,
        status: result?.status ?? "missing",
        filePath: result?.filePath,
        br: result?.br,
        size: result?.size,
        type: result?.type,
        error: result?.error,
      };
    }),
  };
  await writeJsonAtomically(manifestPath, manifestData);

  // Abort if any tracks failed - progress is saved for retry
  if (failed.length > 0) {
    const failedIds = failed.map((r) => r.id).join(", ");
    throw new AudioDownloadError(
      "PLAYBACK_REQUEST_FAILED",
      `${failed.length} track(s) failed to download: ${failedIds}. Run again to retry missing tracks.`,
    );
  }

  return {
    workspace,
    directory: audioDirectory,
    manifest: manifestPath,
    trackCount: plan.tracks.length,
    downloadedCount: downloaded.length,
    placeholderCount: 0,
    warnings: [],
  };
}

async function readPlan(workspacePath: string): Promise<unknown> {
  const filePath = path.join(workspacePath, INFO_FILE);
  let content: string;
  try {
    content = await readFile(filePath, "utf8");
  } catch (error) {
    if (isNodeError(error) && error.code === "ENOENT") {
      throw new AudioDownloadError(
        "MISSING_AUDIO_DEPENDENCY",
        "Required audio dependency info.json does not exist.",
      );
    }
    throw error;
  }

  try {
    return JSON.parse(content);
  } catch {
    throw new AudioDownloadError(
      "INVALID_AUDIO_DEPENDENCY",
      "Required audio dependency info.json is not valid JSON.",
    );
  }
}

function validatePlan(value: unknown): PlanInput {
  const root = asObject(value);
  const think = asString(root?.think)?.trim();
  const rawTrackIds = Array.isArray(root?.track_ids)
    ? root.track_ids
    : undefined;

  if (
    root === undefined ||
    !Object.hasOwn(root, "think") ||
    !Object.hasOwn(root, "track_ids") ||
    think === undefined ||
    think.length === 0 ||
    rawTrackIds === undefined ||
    rawTrackIds.length === 0
  ) {
    throw new AudioDownloadError(
      "INVALID_AUDIO_DEPENDENCY",
      "info.json must contain a non-empty think and track_ids array.",
    );
  }

  const tracks = rawTrackIds.map((value, index) => {
    const id = asJsonId(value);
    if (id === undefined) {
      throw new AudioDownloadError(
        "INVALID_AUDIO_DEPENDENCY",
        `info.json contains an invalid track id at index ${index}.`,
      );
    }
    return { order: index + 1, id };
  });

  // Validate unique ids
  const ids = tracks.map((t) => String(t.id));
  if (new Set(ids).size !== ids.length) {
    throw new AudioDownloadError(
      "INVALID_AUDIO_DEPENDENCY",
      "info.json contains duplicate track ids.",
    );
  }

  return { tracks: tracks as PlanTrack[] };
}

function asObject(value: unknown): JsonObject | undefined {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as JsonObject)
    : undefined;
}

function asArray(value: unknown): unknown[] | undefined {
  return Array.isArray(value) ? value : undefined;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" ? value : undefined;
}

function asNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function getErrorMessage(error: unknown): string {
  return error instanceof Error ? error.message : "Unknown error";
}



async function writeJsonAtomically(filePath: string, value: unknown): Promise<void> {
  const tempPath = `${filePath}.${process.pid}.${Date.now()}.tmp`;
  try {
    await writeFile(tempPath, `${JSON.stringify(value, null, 2)}\n`, {
      encoding: "utf8",
      flag: "wx",
    });
    await rename(tempPath, filePath);
  } finally {
    await rm(tempPath, { force: true });
  }
}

function asJsonId(value: unknown): JsonId | undefined {
  if (typeof value === "string" && /^\d+$/u.test(value)) {
    return value;
  }
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) {
    return value;
  }
  return undefined;
}

function isNodeError(error: unknown): error is NodeJS.ErrnoException {
  return error instanceof Error && "code" in error;
}

async function fileExists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}
