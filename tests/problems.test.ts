import { describe, expect, it } from 'vitest';
import { PROBLEMS } from '../src/data/problems';
import { TOPICS } from '../src/data/topics';
import { validateSet } from '../src/data/validate';
import { parsePoint } from '../src/go/board';
import { evaluateMove, solutionFrames, startBoard } from '../src/go/evaluate';

describe('problem set', () => {
  it('has exactly 100 problems and passes the validator', () => {
    const errors = validateSet(PROBLEMS, TOPICS).filter((i) => i.level === 'error');
    expect(errors).toEqual([]);
    expect(PROBLEMS).toHaveLength(100);
  }, 120_000);

  it('runtime evaluation agrees with the answer lists', () => {
    for (const p of PROBLEMS) {
      const start = startBoard(p);
      for (const a of p.solutions) {
        const out = evaluateMove(p, start, parsePoint(a.move));
        expect(out.kind === 'move' && out.verdict, `${p.id} ${a.move}`).toBe('correct');
      }
      for (const a of p.better ?? []) {
        const out = evaluateMove(p, start, parsePoint(a.move));
        expect(out.kind === 'move' && out.verdict, `${p.id} ${a.move}`).toBe('better');
      }
      for (const a of p.wrong ?? []) {
        const out = evaluateMove(p, start, parsePoint(a.move));
        expect(out.kind === 'move' && out.verdict, `${p.id} ${a.move}`).toBe('wrong');
      }
      expect(solutionFrames(p, start).length).toBeGreaterThan(0);
    }
  });

  it('every unlisted legal move gets a non-empty "try again" explanation', () => {
    for (const p of PROBLEMS) {
      const start = startBoard(p);
      for (let i = 0; i < start.length; i++) {
        const out = evaluateMove(p, start, i);
        if (out.kind === 'move') expect(out.text.trim().length, `${p.id} @${i}`).toBeGreaterThan(10);
      }
    }
  });
});
