import { describe, expect, it } from 'vitest';
import { type Board, type Color, groupAt, parseDiagram, parsePoint, play, pointName } from '../src/go/board';
import { bensonAlive, canCapture, canLive } from '../src/go/reading';

const P = parsePoint;
function after(b: Board, m: string, c: Color): Board {
  const r = play(b, P(m), c);
  if (!r.ok) throw new Error(r.error);
  return r.board;
}

describe('coordinates', () => {
  it('round-trips and skips I', () => {
    expect(pointName(P('A1'))).toBe('A1');
    expect(pointName(P('J9'))).toBe('J9');
    expect(P('I5')).toBe(-1);
    expect(P('K1')).toBe(-1);
    expect(P('A0')).toBe(-1);
  });
});

describe('rules', () => {
  const b = parseDiagram([
    '.........',
    '.........',
    '.........',
    '.........',
    '....X....',
    '...XOX...',
    '.........',
    '.........',
    'OX.......',
  ]);

  it('counts liberties', () => {
    expect(groupAt(b, P('E4'))!.liberties.length).toBe(1);
    expect(groupAt(b, P('A1'))!.liberties.length).toBe(1);
  });

  it('captures', () => {
    const r = play(b, P('E3'), 'B');
    expect(r.ok && r.captured.map(pointName)).toEqual(['E4']);
  });

  it('rejects occupied and suicide', () => {
    expect(play(b, P('E4'), 'B')).toEqual({ ok: false, error: 'occupied' });
    const s = parseDiagram(['.........', '.........', '.........', '.........', '.........', '.........', '.........', 'X........', '.X.......']);
    expect(play(s, P('A1'), 'W')).toEqual({ ok: false, error: 'suicide' });
  });

  it('allows a move without liberties when it captures', () => {
    const s = parseDiagram(['.........', '.........', '.........', '.........', '.........', '.........', 'O........', 'XO.......', '.XO......']);
    const r = play(s, P('A1'), 'W');
    expect(r.ok).toBe(true);
  });
});

describe('reading', () => {
  it('reads a ladder', () => {
    const b = parseDiagram([
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      '..XO.....',
      '...XX....',
      '.........',
      '.........',
    ]);
    // White D4 has two liberties; the ladder toward the upper right works.
    expect(canCapture(b, P('D4'))).toBe(true);
    // A white ladder breaker on the ladder's path lets White escape.
    expect(canCapture(after(b, 'G7', 'W'), P('D4'))).toBe(false);
  });

  it('a stone with 3 liberties cannot be caught by the simple reader', () => {
    const b = parseDiagram(['.........', '.........', '.........', '.........', '....O....', '....X....', '.........', '.........', '.........']);
    expect(canCapture(b, P('E5'))).toBe(false);
  });
});

describe('life and death', () => {
  const twoEyes = parseDiagram([
    '.........',
    '.........',
    '.........',
    '.........',
    '.........',
    'OOOOO....',
    'XXXXXO...',
    'X.X.XO...',
    'XXXXXO...',
  ]);
  it('Benson sees two eyes', () => {
    expect(bensonAlive(twoEyes, 'B').has(P('A1'))).toBe(true);
  });
  it('three-point eye: vital point decides', () => {
    const b = parseDiagram([
      '.........',
      '.........',
      '.........',
      '.........',
      '.........',
      'OOOOO....',
      'XXXXO....',
      '...XO....',
      'XXXXO....',
    ]);
    expect(canLive(b, P('A1'), 'B')).toBe(true);
    expect(canLive(b, P('A1'), 'W')).toBe(false);
  });
});
