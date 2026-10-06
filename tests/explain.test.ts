import { describe, expect, it } from 'vitest';
import { POINTS, parsePoint } from '../src/go/board';
import { type GameState, PASS, applyMove, newGame } from '../src/katago/search';
import { explainComparison, explainMove, groupChanges, regionDeltas, regionOf, tacticalClause } from '../src/play/explain';

const P = parsePoint;
function game(moves: string[]): GameState {
  let s = newGame();
  for (const m of moves) s = applyMove(s, m === 'pass' ? PASS : P(m))!;
  return s;
}
const flat = (v: number) => new Array<number>(POINTS).fill(v);
/** Ownership map with `v` inside the 3×3 block of `region`, 0 elsewhere. */
function block(region: string, v: number): number[] {
  return flat(0).map((_, i) => (regionOf(i) === region ? v : 0));
}

describe('regions', () => {
  it('names the nine areas of the board', () => {
    expect(regionOf(P('A1'))).toBe('left-bottom');
    expect(regionOf(P('E5'))).toBe('center-middle');
    expect(regionOf(P('J9'))).toBe('right-top');
    expect(regionOf(P('C3'))).toBe('left-bottom');
    expect(regionOf(P('D3'))).toBe('center-bottom');
  });
  it('measures who gains where', () => {
    const d = regionDeltas(flat(0), block('left-bottom', 1), 'B');
    expect(d[0]).toEqual({ region: 'left-bottom', delta: 9 });
    expect(regionDeltas(flat(0), block('left-bottom', 1), 'W')[0]!.delta).toBe(-9);
  });
});

describe('group fate', () => {
  it('detects a group that dies', () => {
    const s = game(['C3', 'E5']);
    const alive = flat(0).map((_, i) => (i === P('C3') ? 0.9 : 0));
    const dead = flat(0).map((_, i) => (i === P('C3') ? -0.9 : 0));
    const ch = groupChanges(s.board, alive, dead);
    expect(ch).toHaveLength(1);
    expect(ch[0]!.from).toBe('safe');
    expect(ch[0]!.to).toBe('dead');
  });
});

describe('explanations', () => {
  it('explains a tactical move first', () => {
    const s = game(['D5', 'E5', 'F5', 'A9', 'E6', 'A8']);
    expect(tacticalClause(s.board, P('E4'), 'B', 'B')).toBe('захватывает 1 камень');
    const lines = explainMove({ board: s.board, move: P('E4'), color: 'B', learner: 'B', before: null, after: null });
    expect(lines[0]).toBe('Захватывает 1 камень.');
  });

  it('explains what KataGo is taking', () => {
    const s = game(['E5']);
    const before = flat(0);
    const after = block('right-top', -0.8);
    const lines = explainMove({ board: s.board, move: P('G7'), color: 'W', learner: 'B', before, after });
    expect(lines.join(' ')).toContain('Белые занимают правый верхний угол');
  });

  it('does not talk about the fate of the stone just played', () => {
    const s = game(['C3']);
    const after = flat(0).map((_, i) => (i === P('E5') ? -0.9 : 0));
    const lines = explainMove({ board: s.board, move: P('E5'), color: 'W', learner: 'B', before: flat(0), after });
    expect(lines.join(' ')).not.toContain('E5');
  });

  it('warns when a move endangers a group', () => {
    const s = game(['C3', 'E5']);
    const before = flat(0).map((_, i) => (i === P('C3') ? 0.9 : 0));
    const after = flat(0).map((_, i) => (i === P('C3') ? 0.1 : 0));
    const lines = explainMove({ board: s.board, move: P('D3'), color: 'W', learner: 'B', before, after });
    expect(lines.join(' ')).toContain('Твой камень C3 оказывается под угрозой');
  });

  it('only blames a group fate that favours the better move', () => {
    const s = game(['E5', 'C3']);
    const whiteC3 = (v: number) => flat(0).map((_, i) => (i === P('C3') ? v : 0));
    // After the played move white C3 dies — that is good for black, so it is not a reason.
    const lines = explainComparison({ board: s.board, learner: 'B', move: P('J9'), best: P('G5'), bestEnd: whiteC3(-0.1), moveEnd: whiteC3(0.9), loss: 4 });
    expect(lines.join(' ')).not.toContain('C3');
    const blamed = explainComparison({ board: s.board, learner: 'B', move: P('J9'), best: P('G5'), bestEnd: whiteC3(0.9), moveEnd: whiteC3(-0.1), loss: 4 });
    expect(blamed.join(' ')).toContain('Белый камень C3: после G5 — мёртвый, после J9 — под угрозой');
  });

  it('compares the better move with the played one', () => {
    const s = game(['E5', 'G7']);
    const lines = explainComparison({
      board: s.board,
      learner: 'B',
      move: P('A9'),
      best: P('C3'),
      bestEnd: block('left-bottom', 0.9),
      moveEnd: block('left-bottom', -0.5),
      loss: 12,
    });
    expect(lines.join(' ')).toContain('После C3 левый нижний угол получается твоим примерно на 13 очков больше');
  });
});
