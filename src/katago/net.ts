// KataGo network in TensorFlow.js: backend selection, model loading and single-position evaluation.
// Runs inside the Web Worker (see worker.ts).

import * as tf from '@tensorflow/tfjs';
import '@tensorflow/tfjs-backend-webgpu';
import { setWasmPaths } from '@tensorflow/tfjs-backend-wasm';
import wasmPlain from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm.wasm?url';
import wasmSimd from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-simd.wasm?url';
import wasmThreaded from '@tensorflow/tfjs-backend-wasm/dist/tfjs-backend-wasm-threaded-simd.wasm?url';
import pako from 'pako';
import { type Cell, SIZE } from '../go/board';
import { postprocessKataGoV8 } from './vendor/engine/katago/evalV8';
import { setBoardSize } from './vendor/engine/katago/fastBoard';
import { parseKataGoModelV8 } from './vendor/engine/katago/loadModelV8';
import { KataGoModelV8Tf } from './vendor/engine/katago/modelV8';
import { fillInputsV7FastForPosition } from './vendor/engine/katago/positionInputsV7';
import type { BoardState, Move, Player } from './vendor/types';
import { KOMI } from './rules';

export type Backend = 'webgpu' | 'wasm' | 'cpu';

export interface NetEval {
  /** Probability for each of the 81 points (index = y*9+x) and pass at index 81. Sums to 1. */
  policy: Float32Array;
  /** Win probability for the side to move. */
  winrate: number;
  /** Score lead for the side to move, in points. */
  lead: number;
  /** Per point, −1 (white owns) … +1 (black owns). Only when requested. */
  ownership?: Float32Array;
}

export interface HistoryMove {
  /** Board index 0..80, or -1 for pass. */
  point: number;
  color: 'B' | 'W';
}


let model: KataGoModelV8Tf | null = null;
let backend: Backend | null = null;
const spatial = new Float32Array(SIZE * SIZE * 22);
const global = new Float32Array(19);

async function trySetBackend(name: Backend): Promise<boolean> {
  try {
    if (!(await tf.setBackend(name))) return false;
    await tf.ready();
    return true;
  } catch {
    return false;
  }
}

/** Picks the fastest working backend: WebGPU, then WASM, then plain JS. */
export async function initBackend(prefer: Backend | 'auto' = 'auto'): Promise<{ backend: Backend; notes: string[] }> {
  const notes: string[] = [];
  setWasmPaths({
    'tfjs-backend-wasm.wasm': wasmPlain,
    'tfjs-backend-wasm-simd.wasm': wasmSimd,
    'tfjs-backend-wasm-threaded-simd.wasm': wasmThreaded,
  });
  const order: Backend[] = prefer === 'auto' ? ['webgpu', 'wasm', 'cpu'] : [prefer, 'wasm', 'cpu'];
  for (const name of order) {
    if (await trySetBackend(name)) {
      backend = name;
      tf.enableProdMode();
      return { backend: name, notes };
    }
    notes.push(`${name} недоступен`);
  }
  throw new Error('Не удалось запустить TensorFlow.js ни на одном backend');
}

export type Progress = (loaded: number, total: number) => void;

/** Reads a response body, reporting progress against `total` starting from `offset`. */
async function readWithProgress(res: Response, offset: number, total: number, onProgress?: Progress): Promise<Uint8Array> {
  if (!res.body) return new Uint8Array(await res.arrayBuffer());
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let got = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    chunks.push(value);
    got += value.length;
    onProgress?.(offset + got, total);
  }
  const out = new Uint8Array(got);
  let p = 0;
  for (const c of chunks) {
    out.set(c, p);
    p += c.length;
  }
  return out;
}

interface SplitManifest {
  name: string;
  size: number;
  parts: string[];
}

/**
 * Loads a network from a single `.bin.gz` URL or from a `manifest.json` describing parts
 * (big networks are split to fit static hosting limits).
 */
export async function loadModel(url: string, onProgress?: Progress): Promise<{ name: string; bytes: number }> {
  if (url.endsWith('.json')) {
    const mres = await fetch(url);
    if (!mres.ok) throw new Error(`Не удалось скачать описание сети: ${mres.status}`);
    const manifest = (await mres.json()) as SplitManifest;
    const all = new Uint8Array(manifest.size);
    let offset = 0;
    for (const part of manifest.parts) {
      const res = await fetch(new URL(part, url).href);
      if (!res.ok) throw new Error(`Не удалось скачать часть сети ${part}: ${res.status}`);
      const buf = await readWithProgress(res, offset, manifest.size, onProgress);
      if (offset + buf.length > manifest.size) throw new Error('Файл сети больше ожидаемого');
      all.set(buf, offset);
      offset += buf.length;
    }
    if (offset !== manifest.size) throw new Error(`Сеть скачалась не полностью (${offset} из ${manifest.size} байт)`);
    return loadModelBytes(all);
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`Не удалось скачать сеть: ${res.status}`);
  const total = Number(res.headers.get('content-length') ?? 0);
  return loadModelBytes(await readWithProgress(res, 0, total, onProgress));
}

export async function loadModelBytes(raw: Uint8Array): Promise<{ name: string; bytes: number }> {
  let data = raw;
  const bytes = data.length;
  if (data[0] === 0x3c) throw new Error('Вместо файла сети пришла веб-страница — неверный путь к сети');
  if (data[0] === 0x1f && data[1] === 0x8b) data = pako.ungzip(data);
  setBoardSize(SIZE);
  const parsed = parseKataGoModelV8(data);
  model?.dispose();
  model = new KataGoModelV8Tf(parsed);
  // Warm-up: compiles shaders / kernels for the 9×9 shapes.
  await evaluate(new Array<Cell>(SIZE * SIZE).fill(null), 'B', []);
  return { name: parsed.modelName, bytes };
}

export function currentBackend(): Backend | null {
  return backend;
}

function toBoardState(b: readonly Cell[]): BoardState {
  const rows: BoardState = [];
  for (let y = 0; y < SIZE; y++) {
    const row: BoardState[number] = [];
    for (let x = 0; x < SIZE; x++) {
      const c = b[y * SIZE + x];
      row.push(c === 'B' ? 'black' : c === 'W' ? 'white' : null);
    }
    rows.push(row);
  }
  return rows;
}

const player = (c: 'B' | 'W'): Player => (c === 'B' ? 'black' : 'white');

/**
 * Evaluates a position. `history` is the full move list that led to it (oldest first);
 * `previous` boards let the net see recent captures and ko.
 */
export async function evaluate(
  board: readonly Cell[],
  toPlay: 'B' | 'W',
  history: HistoryMove[],
  previous: (readonly Cell[])[] = [],
  withOwnership = false,
): Promise<NetEval> {
  if (!model) throw new Error('Сеть не загружена');
  const moveHistory: Move[] = history.map((m) => ({
    x: m.point < 0 ? -1 : m.point % SIZE,
    y: m.point < 0 ? -1 : Math.floor(m.point / SIZE),
    player: player(m.color),
  }));
  const prev = previous[previous.length - 1];
  const prevPrev = previous[previous.length - 2];
  fillInputsV7FastForPosition({
    board: toBoardState(board),
    previousBoard: prev ? toBoardState(prev) : undefined,
    previousPreviousBoard: prevPrev ? toBoardState(prevPrev) : undefined,
    currentPlayer: player(toPlay),
    moveHistory,
    komi: KOMI,
    rules: 'chinese',
    conservativePassAndIsRoot: false,
    outSpatial: spatial,
    outGlobal: global,
  });
  const spatialT = tf.tensor4d(spatial, [1, SIZE, SIZE, 22]);
  const globalT = tf.tensor2d(global, [1, 19]);
  const out = withOwnership ? model.forward(spatialT, globalT) : { ...model.forwardPolicyValue(spatialT, globalT), ownership: null };
  try {
    const [pol, pass, value, score, own] = await Promise.all([
      out.policy.data(),
      out.policyPass.data(),
      out.value.data(),
      out.scoreValue.data(),
      out.ownership ? out.ownership.data() : Promise.resolve(null),
    ]);
    const channels = model.policyOutChannels;
    const logits = new Float32Array(SIZE * SIZE + 1);
    for (let i = 0; i < SIZE * SIZE; i++) logits[i] = pol[i * channels]!;
    logits[SIZE * SIZE] = pass[0]!;
    let max = -Infinity;
    for (let i = 0; i < logits.length; i++) if (board[i] == null || i === SIZE * SIZE) max = Math.max(max, logits[i]!);
    const policy = new Float32Array(logits.length);
    let sum = 0;
    for (let i = 0; i < logits.length; i++) {
      if (i < SIZE * SIZE && board[i] != null) continue;
      policy[i] = Math.exp(logits[i]! - max);
      sum += policy[i]!;
    }
    for (let i = 0; i < policy.length; i++) policy[i] = policy[i]! / sum;
    const ev = postprocessKataGoV8({
      nextPlayer: player(toPlay),
      valueLogits: value,
      scoreValue: score,
      postProcessParams: model.postProcessParams,
      modelVersion: model.modelVersion,
    });
    const black = toPlay === 'B';
    let ownership: Float32Array | undefined;
    if (own) {
      // The net predicts ownership for the side to move; convert to black's view.
      const scale = model.postProcessParams?.outputScaleMultiplier ?? 1;
      ownership = new Float32Array(SIZE * SIZE);
      for (let i = 0; i < ownership.length; i++) ownership[i] = (black ? 1 : -1) * Math.tanh(own[i]! * scale);
    }
    return {
      policy,
      winrate: black ? ev.blackWinProb : 1 - ev.blackWinProb,
      lead: black ? ev.blackScoreLead : -ev.blackScoreLead,
      ownership,
    };
  } finally {
    spatialT.dispose();
    globalT.dispose();
    out.policy.dispose();
    out.policyPass.dispose();
    out.value.dispose();
    out.scoreValue.dispose();
    out.ownership?.dispose();
  }
}
