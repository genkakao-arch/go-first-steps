import { beforeEach, describe, expect, it } from 'vitest';
import { POINTS, parsePoint } from '../src/go/board';
import { type GameState, type MoveStat, PASS, type SearchResult, applyMove, newGame } from '../src/katago/search';
import { describePosition, judgeUserMove, noteEngineMove } from '../src/play/coach';
import { adaptLevel, chooseMove } from '../src/play/levels';
import { loadPlay, replay } from '../src/play/saved';
import { finalScore } from '../src/play/scoring';

const P = parsePoint;

function game(moves: string[]): GameState {
  let s = newGame();
  for (const m of moves) {
    const n = applyMove(s, m === 'pass' ? PASS : P(m));
    if (!n) throw new Error(`illegal ${m}`);
    s = n;
  }
  return s;
}

function result(moves: [string, number, number?][], lead = 0): SearchResult {
  const stats: MoveStat[] = moves.map(([m, l, visits]) => ({
    move: m === 'pass' ? PASS : P(m),
    lead: l,
    winrate: 0.5,
    visits: visits ?? 50,
    prior: 0.1,
  }));
  return { move: stats[0]!.move, visits: 100, winrate: 0.5, lead, moves: stats, evals: 100 };
}

describe('coach', () => {
  it('flags a move that leaves its own group in atari', () => {
    // White stones around C5; black to play C5 would sit with one liberty.
    const before = game(['A1', 'B5', 'A2', 'C6', 'A3', 'D5', 'J1', 'J9']);
    expect(before.toPlay).toBe('B');
    const note = judgeUserMove({
      before,
      move: P('C5'),
      analysisBefore: result([['E5', 5], ['C5', 0, 20]]),
      analysisAfter: result([['C5', 0]]),
    });
    expect(note?.kind).toBe('inaccuracy');
    expect(note?.text).toContain('одна свобода');
  });

  it('points out a missed capture', () => {
    // White E5 surrounded on three sides by black; its last liberty is E4.
    const before = game(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
    const note = judgeUserMove({
      before,
      move: P('C3'),
      analysisBefore: result([['E4', 8], ['C3', 1, 20]]),
      analysisAfter: result([['E4', -1]]),
    });
    expect(note?.kind).toBe('mistake');
    expect(note?.text).toContain('Можно было захватить 1 камень ходом E4');
    expect(note?.mark).toBe(P('E4'));
  });

  it('praises a capture and stays silent on small losses', () => {
    const before = game(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
    const good = judgeUserMove({
      before,
      move: P('E4'),
      analysisBefore: result([['E4', 8]]),
      analysisAfter: result([['C3', -8]]),
    });
    expect(good?.kind).toBe('good');
    const quiet = judgeUserMove({
      before,
      move: P('C3'),
      analysisBefore: result([['E4', 2], ['C3', 1, 20]]),
      analysisAfter: result([['E4', -1]]),
    });
    expect(quiet).toBeNull();
  });

  it('warns when KataGo puts a group in atari', () => {
    // Black E5 with white D5, F5; white to play E6 → black E5 has one liberty (E4).
    const s = game(['E5', 'D5', 'A1', 'F5', 'A2']);
    expect(s.toPlay).toBe('W');
    const note = noteEngineMove(s, P('E6'));
    expect(note?.kind).toBe('warning');
    expect(note?.text).toContain('Твой камень E5 в атари');
    expect(note?.mark).toBe(P('E4'));
  });

  it('describes capturable stones', () => {
    const s = game(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
    const d = describePosition(s, result([['E4', 8]], 8));
    expect(d.lines.join(' ')).toContain('Белый камень E5 можно захватить ходом E4');
    expect(d.mark).toBe(P('E4'));
  });
});

describe('levels', () => {
  const res = result([
    ['E5', 5],
    ['D4', 4],
    ['A1', -20],
    ['pass', -30],
  ]);
  it('top level always plays the best move', () => {
    expect(chooseMove(res, 10)).toBe(P('E5'));
  });
  it('low levels never play big blunders or pass', () => {
    for (let i = 0; i < 50; i++) {
      const m = chooseMove(res, 1, () => i / 50);
      expect([P('E5'), P('D4')]).toContain(m);
    }
  });
  it('adapts after games', () => {
    expect(adaptLevel(3, true)).toBe(4);
    expect(adaptLevel(1, false)).toBe(1);
    expect(adaptLevel(10, true)).toBe(10);
  });
});

describe('scoring', () => {
  it('removes dead stones by ownership and counts area', () => {
    const s = game(['E5', 'J9']);
    const own = new Array<number>(POINTS).fill(0.9); // black owns everything, white J9 is dead
    const f = finalScore(s.board, own);
    expect(f.dead).toEqual([P('J9')]);
    expect(f.black).toBe(81);
    expect(f.score).toBe(81 - 7);
  });
});

describe('saved games', () => {
  beforeEach(() => {
    const store = new Map<string, string>();
    globalThis.localStorage = {
      getItem: (k: string) => store.get(k) ?? null,
      setItem: (k: string, v: string) => void store.set(k, v),
      removeItem: (k: string) => void store.delete(k),
      clear: () => store.clear(),
      key: () => null,
      length: 0,
    };
  });
  it('survives corrupted data', () => {
    localStorage.setItem('go-trainer-play', '{"level": 99, "moves": [1, "x", 500]');
    expect(loadPlay()).toEqual({ level: 3, games: 0, wins: 0, moves: [] });
    localStorage.setItem('go-trainer-play', '{"level": 5, "games": 2, "wins": 1, "moves": [40, 41, "x", 500]}');
    expect(loadPlay()).toEqual({ level: 5, games: 2, wins: 1, moves: [40, 41] });
  });
  it('replays moves and stops at an illegal one', () => {
    const s = replay([40, 41, 40]);
    expect(s.history).toHaveLength(2);
  });
});
