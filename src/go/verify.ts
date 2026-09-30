// Goal predicates and assertions used by the validator and tests (heavy reading lives here,
// so the runtime bundle does not need it).

import type { Assertion, Goal } from '../data/types';
import { type Board, type Color, emptyRegion, groupAt, other, parsePoint, play, sameGroup } from './board';
import { canCapture, canEscape, canLive } from './reading';

/** Does playing `move` for `me` on `start` achieve the goal? */
export function achievesGoal(goal: Goal, start: Board, move: number, me: Color): boolean {
  const r = play(start, move, me);
  if (!r.ok) return false;
  const b = r.board;
  const opp = other(me);
  switch (goal.type) {
    case 'capture': {
      const pts = goal.targets.map(parsePoint);
      if (pts.every((t) => b[t] !== opp)) return true;
      if (!goal.read) return false;
      // Forced capture: opponent to move cannot save any target.
      return pts.every((t) => b[t] !== opp || !canEscape(b, t, { depth: 30, maxLibs: 3 }));
    }
    case 'atari': {
      const g = groupAt(b, parsePoint(goal.target));
      const own = groupAt(b, move)!;
      return !!g && g.color === opp && g.liberties.length === 1 && own.liberties.length >= 2;
    }
    case 'double-atari': {
      const [a, c] = goal.targets.map((x) => groupAt(b, parsePoint(x)));
      const own = groupAt(b, move)!;
      if (!a || !c || a.color !== opp || c.color !== opp || a.stones.includes(c.stones[0]!)) return false;
      return a.liberties.length === 1 && c.liberties.length === 1 && a.liberties[0] !== c.liberties[0] && own.liberties.length >= 2;
    }
    case 'escape': {
      const t = parsePoint(goal.target);
      if (b[t] !== me) return false;
      return !canCapture(b, t, { depth: 30 });
    }
    case 'connect': {
      const [first, ...rest] = goal.stones.map(parsePoint);
      return rest.every((s) => sameGroup(b, first!, s));
    }
    case 'cut': {
      const [a, c] = goal.stones.map(parsePoint) as [number, number];
      if (b[a] !== opp || b[c] !== opp || sameGroup(b, a, c)) return false;
      // Opponent must not be able to reconnect in one move…
      for (let i = 0; i < b.length; i++) {
        if (b[i]) continue;
        const rr = play(b, i, opp);
        if (rr.ok && rr.board[a] === opp && rr.board[c] === opp && sameGroup(rr.board, a, c)) return false;
      }
      // …and must not be able to capture the cutting stone.
      return !canCapture(b, move, { depth: 20 });
    }
    case 'live': {
      const t = parsePoint(goal.target);
      return b[t] === me && canLive(b, t, opp);
    }
    case 'kill': {
      const t = parsePoint(goal.target);
      return b[t] !== opp || !canLive(b, t, opp);
    }
    case 'enclose': {
      const p = parsePoint(goal.point);
      if (b[p]) return false;
      const reg = emptyRegion(b, p);
      return !reg.borders.has(opp) && reg.points.length <= 30;
    }
  }
}

/** Returns an error message, or null when the assertion holds. */
/** `boards`: the start position followed by the position after every move of the sequence. */
export function checkAssertion(a: Assertion, boards: Board[]): string | null {
  const after = boards[boards.length - 1]!;
  if ('libs' in a) {
    const g = groupAt(after, parsePoint(a.libs));
    if (!g) return `libs ${a.libs}: no stone`;
    return g.liberties.length === a.n ? null : `libs ${a.libs}: expected ${a.n}, got ${g.liberties.length}`;
  }
  if ('captured' in a) {
    for (const s of a.captured) {
      const i = parsePoint(s);
      if (!boards.some((b) => b[i])) return `captured ${s}: there was never a stone`;
      if (after[i]) return `captured ${s}: point is not empty`;
    }
    return null;
  }
  if ('same' in a) {
    const [f, ...rest] = a.same.map(parsePoint);
    return rest.every((s) => sameGroup(after, f!, s)) ? null : `same ${a.same.join(',')}: not one group`;
  }
  if ('apart' in a) {
    const [f, s] = a.apart.map(parsePoint) as [number, number];
    if (!after[f] || !after[s]) return `apart ${a.apart.join(',')}: missing stone`;
    return sameGroup(after, f, s) ? `apart ${a.apart.join(',')}: they are one group` : null;
  }
  for (const s of a.empty) if (after[parsePoint(s)]) return `empty ${s}: occupied`;
  return null;
}
