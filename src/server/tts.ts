// Text-to-speech for the commentators, via rany2/edge-tts (Microsoft Edge's online voices).
// The reference Python CLI is the most reliable client for the service, so we shell out to it.
// Audio is cached on disk by content hash, so each distinct line is synthesised once.
//
// Install once with `npm run setup:tts` (creates ./.venv and pip-installs edge-tts).

import { execFile } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rename } from 'node:fs/promises';
import { join } from 'node:path';
import { COMMENTATORS } from '../shared/content';
import type { CommentatorId } from '../shared/content';

const ROOT = process.cwd();
const CACHE_DIR = join(ROOT, '.cache', 'tts');
const MAX_TEXT = 300;
const MAX_PARALLEL = 3;
const TIMEOUT_MS = 15000;

function resolveBinary(): string | null {
  const local = join(ROOT, '.venv', 'bin', 'edge-tts');
  if (existsSync(local)) return local;
  return process.env.EDGE_TTS_BIN ?? null;
}

const inflight = new Map<string, Promise<Buffer>>();
let active = 0;
const waiting: (() => void)[] = [];
let disabledUntil = 0;
let warnedMissing = false;

export function isSpeaker(v: string): v is CommentatorId {
  return v in COMMENTATORS;
}

export function ttsAvailable(): boolean {
  return resolveBinary() !== null;
}

function keyFor(speaker: CommentatorId, text: string): string {
  const c = COMMENTATORS[speaker];
  return createHash('sha1').update(`${c.voice}|${c.rate}|${c.pitch}|${c.volume}|${text}`).digest('hex');
}

async function slot<T>(fn: () => Promise<T>): Promise<T> {
  if (active >= MAX_PARALLEL) await new Promise<void>((res) => waiting.push(res));
  active++;
  try {
    return await fn();
  } finally {
    active--;
    waiting.shift()?.();
  }
}

function runEdge(bin: string, speaker: CommentatorId, text: string, outFile: string): Promise<void> {
  const c = COMMENTATORS[speaker];
  // `--opt=value` form so negative values such as -5% are not parsed as flags.
  const args = [
    `--voice=${c.voice}`,
    `--rate=${c.rate}`,
    `--pitch=${c.pitch}`,
    `--volume=${c.volume}`,
    `--text=${text}`,
    `--write-media=${outFile}`,
  ];
  return new Promise((resolve, reject) => {
    execFile(bin, args, { timeout: TIMEOUT_MS }, (err, _stdout, stderr) => {
      if (err) reject(new Error(`edge-tts failed: ${stderr?.toString().trim() || err.message}`));
      else resolve();
    });
  });
}

/** Returns mp3 bytes for a line, from cache when possible. Throws when TTS is unavailable. */
export async function speak(speaker: CommentatorId, rawText: string): Promise<Buffer> {
  const text = rawText.trim().slice(0, MAX_TEXT);
  if (!text) throw new Error('Empty text');
  const key = keyFor(speaker, text);
  const file = join(CACHE_DIR, `${key}.mp3`);
  try {
    return await readFile(file);
  } catch {
    // not cached yet
  }
  const bin = resolveBinary();
  if (!bin) {
    if (!warnedMissing) {
      warnedMissing = true;
      console.warn('[tts] edge-tts not found. Run `npm run setup:tts` to enable commentator voices.');
    }
    throw new Error('edge-tts is not installed');
  }
  if (Date.now() < disabledUntil) throw new Error('TTS temporarily disabled after failures');
  let p = inflight.get(key);
  if (!p) {
    p = slot(async () => {
      await mkdir(CACHE_DIR, { recursive: true });
      const tmp = `${file}.${process.pid}.tmp`;
      try {
        await runEdge(bin, speaker, text, tmp);
        await rename(tmp, file);
        return await readFile(file);
      } catch (err) {
        // Back off briefly so an offline machine does not hammer the service every round.
        disabledUntil = Date.now() + 15000;
        throw err;
      }
    }).finally(() => inflight.delete(key));
    inflight.set(key, p);
  }
  return p;
}

/** Fire-and-forget cache warming for lines we are about to broadcast. */
export function warm(speaker: CommentatorId, text: string): void {
  speak(speaker, text).catch((e) => console.warn('[tts]', e.message));
}
