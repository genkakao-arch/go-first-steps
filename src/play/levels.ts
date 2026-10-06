// Adaptive strength: KataGo always searches the same way, but at lower levels it is allowed
// to pick a weaker move (bounded point loss, sampled from its own policy).

import { PASS, type SearchResult } from '../katago/search';

export interface Level {
  /** 0 = always the best move; higher = more varied choices. */
  temperature: number;
  /** Largest point loss (vs the best move) KataGo may accept at this level. */
  maxLoss: number;
}

export const MIN_LEVEL = 1;
export const MAX_LEVEL = 10;
export const START_LEVEL = 3;

const TABLE: Record<number, Level> = {
  1: { temperature: 1.0, maxLoss: 15 },
  2: { temperature: 0.9, maxLoss: 11 },
  3: { temperature: 0.8, maxLoss: 8 },
  4: { temperature: 0.7, maxLoss: 6 },
  5: { temperature: 0.6, maxLoss: 4.5 },
  6: { temperature: 0.5, maxLoss: 3.5 },
  7: { temperature: 0.4, maxLoss: 2.5 },
  8: { temperature: 0.3, maxLoss: 1.5 },
  9: { temperature: 0.15, maxLoss: 0.8 },
  10: { temperature: 0, maxLoss: 0 },
};

export function levelParams(level: number): Level {
  return TABLE[Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, Math.round(level)))]!;
}

/** Next level after a finished game: up after a win, down after a loss. */
export function adaptLevel(level: number, userWon: boolean): number {
  return Math.min(MAX_LEVEL, Math.max(MIN_LEVEL, level + (userWon ? 1 : -1)));
}

/** Picks KataGo's move for the given level from a finished search. */
export function chooseMove(res: SearchResult, level: number, rand: () => number = Math.random): number {
  const best = res.moves[0];
  if (!best) return PASS;
  const { temperature, maxLoss } = levelParams(level);
  if (temperature <= 0 || best.move === PASS) return best.move;
  const candidates = res.moves.filter((m) => m.move !== PASS && best.lead - m.lead <= maxLoss);
  if (candidates.length <= 1) return best.move;
  const weights = candidates.map((m) => Math.pow(Math.max(m.prior, 1e-6), 1 / temperature));
  const total = weights.reduce((a, b) => a + b, 0);
  let r = rand() * total;
  for (let i = 0; i < candidates.length; i++) {
    r -= weights[i]!;
    if (r <= 0) return candidates[i]!.move;
  }
  return candidates[candidates.length - 1]!.move;
}
