import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { evaluate, initBackend, loadModelBytes } from '../src/katago/net';
import { PASS, applyMove, newGame, search } from '../src/katago/search';
import { chooseMove } from '../src/play/levels';
import { finalScore } from '../src/play/scoring';

describe('full game end to end (real network)', () => {
  // Slow (~2 min on CPU): run with `npm run test:slow`.
  it.skipIf(!process.env.SLOW)('a KataGo self-play game ends with two passes and a sane score', async () => {
    await initBackend('cpu');
    await loadModelBytes(new Uint8Array(readFileSync('public/models/katago-small.bin.gz')));
    const ev = (s: Parameters<Parameters<typeof search>[2]>[0], own: boolean) =>
      evaluate(s.board, s.toPlay, s.history, s.previous, own);
    let s = newGame();
    let moves = 0;
    while (s.passes < 2 && moves < 150) {
      const r = await search(s, 24, ev);
      s = applyMove(s, chooseMove(r, 10)) ?? applyMove(s, PASS)!;
      moves++;
    }
    expect(s.passes).toBe(2);
    const final = await search({ ...s, passes: 0 }, 1, ev, { ownership: true });
    const f = finalScore(s.board, final.ownership!);
    // Every point is decided at the end of a finished 9×9 game.
    expect(f.area.filter((a) => a === null).length).toBeLessThan(10);
    expect(Math.abs(f.score)).toBeLessThan(40);
    console.log(`self-play: ${moves} moves, score ${f.score}, dead ${f.dead.length}`);
  }, 300_000);
});
