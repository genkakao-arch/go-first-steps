// Persists the current game, the adaptive level and simple stats in localStorage.
// Corrupted data falls back to defaults; a saved game is rebuilt by replaying its moves.

import { POINTS } from '../go/board';
import { type GameState, PASS, applyMove, newGame } from '../katago/search';
import { MAX_LEVEL, MIN_LEVEL, START_LEVEL } from './levels';

const KEY = 'go-trainer-play';

export interface PlayStats {
  level: number;
  games: number;
  wins: number;
}

export interface SavedPlay extends PlayStats {
  /** Moves of the unfinished game (board indices, -1 = pass), or [] for none. */
  moves: number[];
}

const DEFAULTS: SavedPlay = { level: START_LEVEL, games: 0, wins: 0, moves: [] };

const int = (x: unknown, lo: number, hi: number, d: number) =>
  typeof x === 'number' && Number.isInteger(x) && x >= lo && x <= hi ? x : d;

export function loadPlay(): SavedPlay {
  try {
    const raw: unknown = JSON.parse(localStorage.getItem(KEY) ?? 'null');
    if (typeof raw !== 'object' || raw === null) return { ...DEFAULTS };
    const r = raw as Record<string, unknown>;
    const moves = Array.isArray(r.moves) ? r.moves.filter((m): m is number => int(m, PASS, POINTS - 1, -2) !== -2) : [];
    return {
      level: int(r.level, MIN_LEVEL, MAX_LEVEL, START_LEVEL),
      games: int(r.games, 0, 1e6, 0),
      wins: int(r.wins, 0, 1e6, 0),
      moves,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function savePlay(p: SavedPlay): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(p));
  } catch {
    /* ignore: the game still works in memory */
  }
}

/** Replays saved moves; stops at the first illegal one (corrupted data). */
export function replay(moves: number[]): GameState {
  let s = newGame();
  for (const m of moves) {
    const next = applyMove(s, m);
    if (!next) break;
    s = next;
  }
  return s;
}

export function movesOf(s: GameState): number[] {
  return s.history.map((h) => h.point);
}
