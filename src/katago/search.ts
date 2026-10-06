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
  /** Sum of values from the perspective of the player who moved into this node. */
  w = 0;
  children: Node[] | null = null;
  constructor(
    readonly move: number,
    readonly prior: number,
    public state: GameState | null,
  ) {}
}

export interface SearchResult {
  move: number;
  visits: number;
  /** Root win probability for the side to move, averaged over the search. */
  winrate: number;
  /** Root score lead for the side to move (network estimate). */
  lead: number;
  top: { move: number; visits: number; winrate: number; prior: number }[];
  /** Network evaluations performed. */
  evals: number;
}

export type Evaluator = (s: GameState) => Promise<NetEval>;

const C_PUCT = 1.1;
const FPU = 0.2;

export async function search(root: GameState, visits: number, evaluate: Evaluator): Promise<SearchResult> {
  const rootNode = new Node(PASS, 1, root);
  let evals = 0;
  let rootEval: NetEval | null = null;

  const expand = async (node: Node): Promise<number> => {
    const s = node.state!;
    if (s.passes >= 2) {
      const score = areaScore(s.board);
      const moverIsBlack = s.toPlay === 'W';
      return (score > 0) === moverIsBlack ? 1 : 0;
    }
    const ev = await evaluate(s);
    evals++;
    if (node === rootNode) rootEval = ev;
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
    // Value for the player who moved into this node = 1 - winrate of the side to move.
    return 1 - ev.winrate;
  };

  const simulate = async (node: Node): Promise<number> => {
    if (!node.children) {
      const v = await expand(node);
      node.n++;
      node.w += v;
      return v;
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
      // No legal moves at all: treat as a pass position.
      node.n++;
      node.w += 0.5;
      return 0.5;
    }
    if (!best.state) {
      const st = applyMove(node.state!, best.move);
      if (!st) {
        // Illegal (suicide) — drop it and retry.
        node.children = node.children.filter((c) => c !== best);
        return simulate(node);
      }
      best.state = st;
    }
    const childValue = await simulate(best);
    const v = 1 - childValue;
    node.n++;
    node.w += v;
    return v;
  };

  for (let i = 0; i < Math.max(1, visits); i++) await simulate(rootNode);

  const kids = (rootNode.children ?? []).filter((c) => c.n > 0).sort((a, b) => b.n - a.n);
  const rootNet = rootEval as NetEval | null;
  return {
    move: kids[0]?.move ?? PASS,
    visits: rootNode.n,
    winrate: rootNode.n > 0 ? 1 - rootNode.w / rootNode.n : 0.5,
    lead: rootNet ? rootNet.lead : 0,
    top: kids.slice(0, 5).map((c) => ({ move: c.move, visits: c.n, winrate: c.w / c.n, prior: c.prior })),
    evals,
  };
}
