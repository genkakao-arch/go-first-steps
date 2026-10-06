import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { parsePoint } from '../src/go/board';
import { evaluate, initBackend, loadModelBytes } from '../src/katago/net';
import { applyMove, areaScore, newGame, PASS, search } from '../src/katago/search';

describe('KataGo network (CPU backend)', () => {
  it('loads and gives sensible evaluations', async () => {
    await initBackend('cpu');
    const { name } = await loadModelBytes(new Uint8Array(readFileSync('public/models/katago-small.bin.gz')));
    expect(name).toContain('b6c96');

    const g = newGame();
    const ev = await evaluate(g.board, g.toPlay, g.history);
    const sum = ev.policy.reduce((a, b) => a + b, 0);
    expect(sum).toBeCloseTo(1, 3);
    // On an empty 9×9 board the net prefers central points, not the edge.
    const best = ev.policy.indexOf(Math.max(...ev.policy));
    const x = best % 9;
    const y = Math.floor(best / 9);
    expect(x >= 2 && x <= 6 && y >= 2 && y <= 6).toBe(true);
    expect(ev.winrate).toBeGreaterThan(0.2);
    expect(ev.winrate).toBeLessThan(0.8);

    // A white stone in atari: black must see the capture.
    let s = newGame();
    for (const m of ['D5', 'E5', 'F5', 'A9', 'E6', 'A8']) s = applyMove(s, parsePoint(m))!;
    // Black to move, white E5 has one liberty (E4).
    const r = await search(s, 40, (st) => evaluate(st.board, st.toPlay, st.history, st.previous));
    expect(r.move).toBe(parsePoint('E4'));
  }, 120_000);
});

describe('game rules for play', () => {
  it('forbids simple ko recapture and scores by area', () => {
    let s = newGame();
    // Build a ko: black C5 D6 D4, white E5 F6? Use a classic shape.
    for (const m of ['D5', 'E5', 'C4', 'F4', 'D3', 'E3', 'J9', 'D4']) s = applyMove(s, parsePoint(m))!;
    // White D4 is in atari? Black captures it at E4.
    const cap = applyMove(s, parsePoint('E4'))!;
    expect(cap.board[parsePoint('D4')]).toBeNull();
    expect(cap.ko).toBe(parsePoint('D4'));
    expect(applyMove(cap, parsePoint('D4'))).toBeNull();
    expect(applyMove(cap, PASS)).not.toBeNull();
    expect(areaScore(newGame().board)).toBe(-7);
  });
});
