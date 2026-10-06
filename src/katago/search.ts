// Small PUCT/MCTS search on top of the KataGo network, for 9×9 games.
// Rules: Chinese-style area scoring, komi 7, simple ko, suicide forbidden.

import { type Cell, POINTS, SIZE, emptyRegion, other, play } from '../go/board';
import type { HistoryMove, NetEval } from './net';
import { KOMI } from './rules';

export const PASS = -1;

export interface GameState {
  board: Cell[];
  toPlay: 'B' | 'W';
  /** Point forbidden by simple ko for the side to move, or -1. */
  ko: number;
  /** Consecutive passes so far. */
  passes: number;
  history: HistoryMove[];
  /** Earlier boards, oldest first (for the network's history planes). */
  previous: Cell[][];
}

export function newGame(): GameState {
  return { board: new Array<Cell>(POINTS).fill(null), toPlay: 'B', ko: -1, passes: 0, history: [], previous: [] };
}

/** Returns the state after `point` (or PASS), or null when the move is illegal. */
export function applyMove(s: GameState, point: number): GameState | null {
  const color = s.toPlay;
  if (point === PASS) {
    return {
      board: s.board,
      toPlay: other(color),
      ko: -1,
      passes: s.passes + 1,
      history: [...s.history, { point: PASS, color }],
      previous: [...s.previous, s.board].slice(-2),
    };
  }
  if (point === s.ko) return null;
  const r = play(s.board, point, color);
  if (!r.ok) return null;
  let ko = -1;
  if (r.captured.length === 1) {
    // Single-stone recapture shape: our lone stone now has exactly one liberty, the captured point.
    const libs = new Set<number>();
    let ownNeighbors = 0;
    const x = point % SIZE;
    const y = Math.floor(point / SIZE);
    for (const [dx, dy] of [[1, 0], [-1, 0], [0, 1], [0, -1]] as const) {
      const nx = x + dx;
      const ny = y + dy;
      if (nx < 0 || ny < 0 || nx >= SIZE || ny >= SIZE) continue;
      const n = ny * SIZE + nx;
      if (r.board[n] === color) ownNeighbors++;
      else if (!r.board[n]) libs.add(n);
    }
    if (ownNeighbors === 0 && libs.size === 1 && libs.has(r.captured[0]!)) ko = r.captured[0]!;
  }
  return {
    board: r.board,
    toPlay: other(color),
    ko,
    passes: 0,
    history: [...s.history, { point, color }],
    previous: [...s.previous, s.board].slice(-2),
  };
}

/** Area score (stones + surrounded empty points), positive = black ahead, komi included. */
export function areaScore(board: readonly Cell[]): number {
  let score = -KOMI;
  const seen = new Set<number>();
  for (let i = 0; i < POINTS; i++) {
    const c = board[i];
    if (c) score += c === 'B' ? 1 : -1;
    else if (!seen.has(i)) {
      const reg = emptyRegion(board, i);
      reg.points.forEach((p) => seen.add(p));
      if (reg.borders.size === 1) score += (reg.borders.has('B') ? 1 : -1) * reg.points.length;
    }
  }
  return score;
}

class Node {
  n = 0;
  /** Sum of win values from the perspective of the player who moved into this node. */
  w = 0;
  /** Sum of score leads from the same perspective. */
  sl = 0;
  children: Node[] | null = null;
  constructor(
    readonly move: number,
    readonly prior: number,
    public state: GameState | null,
  ) {}
}

export interface MoveStat {
  move: number;
  visits: number;
  /** Win probability for the side to move at the root if it plays this move. */
  winrate: number;
  /** Score lead for the side to move at the root after this move. */
  lead: number;
  prior: number;
  /** Expected continuation after this move (most visited replies), excluding the move itself. */
  pv: number[];
}

export interface SearchResult {
  /** Most visited move. */
  move: number;
  visits: number;
  /** Root win probability for the side to move, averaged over the search. */
  winrate: number;
  /** Root score lead for the side to move, averaged over the search. */
  lead: number;
  /** Every visited root move, most visited first. */
  moves: MoveStat[];
  /** Root ownership (−1 white … +1 black), when requested. */
  ownership?: number[];
  /** Network evaluations performed. */
  evals: number;
}

export type Evaluator = (s: GameState, withOwnership: boolean) => Promise<NetEval>;

const C_PUCT = 1.1;
const PV_DEPTH = 8;
const FPU = 0.2;

export async function search(
  root: GameState,
  visits: number,
  evaluate: Evaluator,
  opts: { ownership?: boolean } = {},
): Promise<SearchResult> {
  const rootNode = new Node(PASS, 1, root);
  let evals = 0;
  let rootOwnership: Float32Array | undefined;

  /** Returns [value, lead] for the player who moved into `node`. */
  const expand = async (node: Node): Promise<[number, number]> => {
    const s = node.state!;
    if (s.passes >= 2) {
      const score = areaScore(s.board);
      const moverIsBlack = s.toPlay === 'W';
      const lead = moverIsBlack ? score : -score;
      return [lead > 0 ? 1 : 0, lead];
    }
    const isRoot = node === rootNode;
    const ev = await evaluate(s, isRoot && !!opts.ownership);
    evals++;
    if (isRoot) rootOwnership = ev.ownership;
    const children: Node[] = [];
    let total = 0;
    for (let i = 0; i <= POINTS; i++) {
      const p = ev.policy[i]!;
      if (p <= 0) continue;
      const move = i === POINTS ? PASS : i;
      if (move !== PASS && (s.board[move] || move === s.ko)) continue;
      children.push(new Node(move, p, null));
      total += p;
    }
    children.sort((a, b) => b.prior - a.prior);
    node.children = children.map((c) => new Node(c.move, c.prior / total, null));
    return [1 - ev.winrate, -ev.lead];
  };

  const simulate = async (node: Node): Promise<[number, number]> => {
    if (!node.children) {
      const r = await expand(node);
      node.n++;
      node.w += r[0];
      node.sl += r[1];
      return r;
    }
    const parentQ = node.n > 0 ? 1 - node.w / node.n : 0.5;
    const sqrtN = Math.sqrt(Math.max(1, node.n));
    let best: Node | null = null;
    let bestScore = -Infinity;
    for (const c of node.children) {
      const q = c.n > 0 ? c.w / c.n : parentQ - FPU;
      const u = (C_PUCT * c.prior * sqrtN) / (1 + c.n);
      if (q + u > bestScore) {
        bestScore = q + u;
        best = c;
      }
    }
    if (!best) {
      node.n++;
      node.w += 0.5;
      return [0.5, 0];
    }
    if (!best.state) {
      const st = applyMove(node.state!, best.move);
      if (!st) {
        node.children = node.children.filter((c) => c !== best);
        return simulate(node);
      }
      best.state = st;
    }
    const [cv, cl] = await simulate(best);
    const r: [number, number] = [1 - cv, -cl];
    node.n++;
    node.w += r[0];
    node.sl += r[1];
    return r;
  };

  for (let i = 0; i < Math.max(1, visits); i++) await simulate(rootNode);

  const principal = (node: Node): number[] => {
    const line: number[] = [];
    let cur = node;
    while (line.length < PV_DEPTH && cur.children) {
      const next = cur.children.reduce<Node | null>((a, c) => (c.n > (a?.n ?? 0) ? c : a), null);
      if (!next || next.n < 2) break;
      line.push(next.move);
      cur = next;
    }
    return line;
  };
  const moves: MoveStat[] = (rootNode.children ?? [])
    .filter((c) => c.n > 0)
    .sort((a, b) => b.n - a.n)
    .map((c) => ({ move: c.move, visits: c.n, winrate: c.w / c.n, lead: c.sl / c.n, prior: c.prior, pv: principal(c) }));
  return {
    move: moves[0]?.move ?? PASS,
    visits: rootNode.n,
    winrate: rootNode.n > 0 ? 1 - rootNode.w / rootNode.n : 0.5,
    lead: rootNode.n > 0 ? -rootNode.sl / rootNode.n : 0,
    moves,
    ownership: rootOwnership ? Array.from(rootOwnership) : undefined,
    evals,
  };
}
