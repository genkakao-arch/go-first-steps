// End-of-game scoring: KataGo's ownership map decides which stones are dead,
// then the cleaned board is counted by area (stones + surrounded empty points) with komi.

import { type Board, type Cell, POINTS, emptyRegion } from '../go/board';
import { KOMI } from '../katago/rules';

export interface FinalScore {
  /** Positive = black wins by this many points (komi included). */
  score: number;
  black: number;
  white: number;
  dead: number[];
  /** Per point: 'B' / 'W' area, or null for neutral points. */
  area: (Cell)[];
}

/** Ownership beyond this (towards the other colour) marks a stone as dead. */
const DEAD = 0.5;

export function finalScore(board: Board, ownership: readonly number[]): FinalScore {
  const dead: number[] = [];
  const clean = board.slice();
  for (let i = 0; i < POINTS; i++) {
    const c = board[i];
    const own = ownership[i] ?? 0;
    if ((c === 'B' && own < -DEAD) || (c === 'W' && own > DEAD)) {
      dead.push(i);
      clean[i] = null;
    }
  }
  const area: Cell[] = new Array<Cell>(POINTS).fill(null);
  const seen = new Set<number>();
  for (let i = 0; i < POINTS; i++) {
    if (clean[i]) {
      area[i] = clean[i]!;
      continue;
    }
    if (seen.has(i)) continue;
    const reg = emptyRegion(clean, i);
    reg.points.forEach((p) => seen.add(p));
    if (reg.borders.size === 1) {
      const owner = [...reg.borders][0]!;
      reg.points.forEach((p) => (area[p] = owner));
    }
  }
  const black = area.filter((a) => a === 'B').length;
  const white = area.filter((a) => a === 'W').length + KOMI;
  return { score: black - white, black, white, dead, area };
}

export function resultText(score: number): string {
  const n = Math.abs(score);
  return `${score > 0 ? 'Чёрные' : 'Белые'} выигрывают на ${Number.isInteger(n) ? n : n.toFixed(1)}`;
}
