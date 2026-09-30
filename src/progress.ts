// Learning progress: kept in localStorage, mirrored to Telegram CloudStorage when available.
// Any stored data is sanitised on load, so corrupted values can never break the app.

import type { TopicId } from './data/types';
import { cloudStorage } from './telegram';

export interface ProblemProgress {
  solved: boolean;
  /** Moves submitted (legal ones). */
  attempts: number;
  /** Hints opened. */
  hints: number;
  /** The solution was shown before the problem was solved. */
  revealed: boolean;
}

export interface Progress {
  v: 1;
  current: string;
  problems: Record<string, ProblemProgress>;
  introsSeen: TopicId[];
  updatedAt: number;
}

export const STORAGE_KEY = 'go-trainer-progress';
const CORRUPT_KEY = 'go-trainer-progress-corrupt';
const CLOUD_KEY = 'progress';

export function emptyProgress(firstId: string): Progress {
  return { v: 1, current: firstId, problems: {}, introsSeen: [], updatedAt: 0 };
}

function isRecord(x: unknown): x is Record<string, unknown> {
  return typeof x === 'object' && x !== null && !Array.isArray(x);
}

function count(x: unknown): number {
  return typeof x === 'number' && Number.isFinite(x) && x >= 0 ? Math.min(Math.floor(x), 9999) : 0;
}

/** Turns arbitrary parsed JSON into a valid Progress, or null when it is not progress at all. */
export function sanitize(raw: unknown, ids: readonly string[], topics: readonly TopicId[]): Progress | null {
  if (!isRecord(raw) || raw.v !== 1 || !isRecord(raw.problems)) return null;
  const known = new Set(ids);
  const problems: Record<string, ProblemProgress> = {};
  for (const [id, val] of Object.entries(raw.problems)) {
    if (!known.has(id) || !isRecord(val)) continue;
    problems[id] = {
      solved: val.solved === true,
      attempts: count(val.attempts),
      hints: count(val.hints),
      revealed: val.revealed === true,
    };
  }
  const current = typeof raw.current === 'string' && known.has(raw.current) ? raw.current : ids[0]!;
  const introsSeen = Array.isArray(raw.introsSeen)
    ? topics.filter((t) => (raw.introsSeen as unknown[]).includes(t))
    : [];
  return { v: 1, current, problems, introsSeen, updatedAt: count(raw.updatedAt) };
}

export function parseProgress(text: string, ids: readonly string[], topics: readonly TopicId[]): Progress | null {
  try {
    return sanitize(JSON.parse(text), ids, topics);
  } catch {
    return null;
  }
}

export interface LoadResult {
  progress: Progress;
  /** Stored data existed but could not be read. */
  recovered: boolean;
}

export function loadLocal(ids: readonly string[], topics: readonly TopicId[]): LoadResult {
  let text: string | null = null;
  try {
    text = localStorage.getItem(STORAGE_KEY);
  } catch {
    /* storage unavailable (private mode etc.) */
  }
  if (text === null) return { progress: emptyProgress(ids[0]!), recovered: false };
  const p = parseProgress(text, ids, topics);
  if (p) return { progress: p, recovered: false };
  try {
    localStorage.setItem(CORRUPT_KEY, text);
  } catch {
    /* ignore */
  }
  return { progress: emptyProgress(ids[0]!), recovered: true };
}

let cloudTimer: ReturnType<typeof setTimeout> | undefined;

export function save(p: Progress): void {
  const text = JSON.stringify(p);
  try {
    localStorage.setItem(STORAGE_KEY, text);
  } catch {
    /* ignore: the in-memory state still works for this session */
  }
  const cloud = cloudStorage();
  if (!cloud) return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const compact = encodeCompact(p);
    if (compact.length <= 4096) cloud.setItem(CLOUD_KEY, compact);
  }, 800);
}

/** Reads the CloudStorage copy (Telegram only). Resolves null when absent or unreadable. */
export function loadCloud(ids: readonly string[], topics: readonly TopicId[]): Promise<Progress | null> {
  const cloud = cloudStorage();
  if (!cloud) return Promise.resolve(null);
  return new Promise((resolve) => {
    const timer = setTimeout(() => resolve(null), 3000);
    cloud.getItem(CLOUD_KEY, (err, value) => {
      clearTimeout(timer);
      resolve(err || !value ? null : decodeCompact(value, ids, topics));
    });
  });
}

// CloudStorage values are limited to 4096 characters, so the mirror uses a compact form:
// {"c":current,"t":updatedAt,"i":[intro topics],"p":{"id":"flags.attempts.hints"}}
function encodeCompact(p: Progress): string {
  const pr: Record<string, string> = {};
  for (const [id, x] of Object.entries(p.problems)) {
    pr[id] = `${(x.solved ? 1 : 0) | (x.revealed ? 2 : 0)}.${x.attempts}.${x.hints}`;
  }
  return JSON.stringify({ c: p.current, t: p.updatedAt, i: p.introsSeen, p: pr });
}

function decodeCompact(text: string, ids: readonly string[], topics: readonly TopicId[]): Progress | null {
  try {
    const raw: unknown = JSON.parse(text);
    if (!isRecord(raw) || !isRecord(raw.p)) return null;
    const problems: Record<string, unknown> = {};
    for (const [id, v] of Object.entries(raw.p)) {
      if (typeof v !== 'string') continue;
      const [f, a, h] = v.split('.').map(Number);
      problems[id] = { solved: ((f ?? 0) & 1) === 1, revealed: ((f ?? 0) & 2) === 2, attempts: a, hints: h };
    }
    return sanitize({ v: 1, current: raw.c, updatedAt: raw.t, introsSeen: raw.i, problems }, ids, topics);
  } catch {
    return null;
  }
}

export function problemState(p: Progress, id: string): ProblemProgress {
  return p.problems[id] ?? { solved: false, attempts: 0, hints: 0, revealed: false };
}
