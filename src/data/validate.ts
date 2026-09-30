// Validator for the problem set: structure, Go legality, meaning of answers, ambiguity,
// and course-level content checks. Used by `npm run validate` and the test suite.

import { type Board, type Cell, POINTS, SIZE, allGroups, boardFromLists, groupAt, neighbors, parsePoint, play, toIndex, toXY } from '../go/board';
import { playSequence } from '../go/evaluate';
import { achievesGoal, checkAssertion } from '../go/verify';
import type { Answer, Problem, Topic } from './types';

export interface Issue {
  id: string;
  level: 'error' | 'warning';
  msg: string;
}

export const EXPECTED_COUNT = 100;

/** Term → regex. A term may be used only from the topic that introduces it onwards. */
export const TERM_PATTERNS: Record<string, RegExp> = {
  'свобода': /свобод/i,
  'захват': /захват/i,
  'группа': /групп/i,
  'атари': /атари/i,
  'самоубийство': /самоубийств/i,
  'разрезание': /разрез/i,
  'лестница': /лестниц/i,
  'сеть': /\bсет(ь|ью|и|к)/i,
  'глаз': /глаз/i,
  'ложный глаз': /ложн\S* глаз/i,
  'жизнь и смерть': /\b(жив|мёртв|мертв)/i,
  'территория': /территори/i,
  'двойное атари': /двойн\S* атари/i,
};

function answersOf(p: Problem): { kind: 'solution' | 'better' | 'wrong'; a: Answer }[] {
  return [
    ...p.solutions.map((a) => ({ kind: 'solution' as const, a })),
    ...(p.better ?? []).map((a) => ({ kind: 'better' as const, a })),
    ...(p.wrong ?? []).map((a) => ({ kind: 'wrong' as const, a })),
  ];
}

function textsOf(p: Problem): string[] {
  return [p.title, p.prompt, p.explanation, ...p.hints, ...answersOf(p).map((x) => x.a.text ?? '')];
}

function goalPoints(p: Problem): { pt: string; color: 'me' | 'opp' | 'empty' }[] {
  const g = p.goal;
  switch (g.type) {
    case 'capture':
    case 'double-atari':
      return g.targets.map((pt) => ({ pt, color: 'opp' as const }));
    case 'atari':
    case 'kill':
      return [{ pt: g.target, color: 'opp' }];
    case 'escape':
    case 'live':
      return [{ pt: g.target, color: 'me' }];
    case 'connect':
      return g.stones.map((pt) => ({ pt, color: 'me' as const }));
    case 'cut':
      return g.stones.map((pt) => ({ pt, color: 'opp' as const }));
    case 'enclose':
      return [{ pt: g.point, color: 'empty' }];
  }
}

export function validateProblem(p: Problem, topics: Topic[]): Issue[] {
  const issues: Issue[] = [];
  const err = (msg: string) => issues.push({ id: p.id, level: 'error', msg });
  const warn = (msg: string) => issues.push({ id: p.id, level: 'warning', msg });

  if (!p.title?.trim()) err('missing title');
  if (!p.prompt?.trim()) err('missing prompt (условие)');
  if (!p.explanation?.trim()) err('missing explanation');
  if (!p.hints || p.hints.length < 2) err('needs at least 2 hints');
  p.hints?.forEach((h, i) => !h.trim() && err(`hint ${i + 1} is empty`));
  if (!p.solutions || p.solutions.length === 0) err('missing solution');
  if (p.toPlay !== 'B' && p.toPlay !== 'W') err(`bad toPlay ${String(p.toPlay)}`);
  if (!topics.some((t) => t.id === p.topic)) err(`unknown topic ${p.topic}`);
  if (p.prompt && p.prompt.length > 160) warn(`prompt is long (${p.prompt.length})`);
  if (p.explanation && p.explanation.length > 420) warn(`explanation is long (${p.explanation.length})`);
  if (issues.some((i) => i.level === 'error')) return issues;

  const built = boardFromLists(p.black ?? '', p.white ?? '');
  for (const e of built.errors) err(`stone ${e.point}: ${e.msg}`);
  if (built.errors.length) return issues;
  const start: Cell[] = built.board;
  for (const g of allGroups(start)) {
    if (g.liberties.length === 0) err(`impossible position: group at ${pointOf(g.stones[0]!)} has no liberties`);
  }

  const me = p.toPlay;
  const opp = me === 'B' ? 'W' : 'B';
  const checkPt = (s: string, what: string): number => {
    const i = parsePoint(s);
    if (i < 0) err(`${what}: coordinate "${s}" is outside 9×9`);
    return i;
  };

  for (const { pt, color } of goalPoints(p)) {
    const i = checkPt(pt, 'goal');
    if (i < 0) continue;
    const want = color === 'me' ? me : color === 'opp' ? opp : null;
    if (start[i] !== want) err(`goal point ${pt} should be ${want ?? 'empty'}, is ${start[i] ?? 'empty'}`);
  }
  for (const m of p.marks ?? []) {
    const i = checkPt(m, 'mark');
    if (i >= 0 && !start[i]) warn(`mark ${m} is on an empty point`);
  }

  const seenMoves = new Map<number, string>();
  for (const { kind, a } of answersOf(p)) {
    const i = checkPt(a.move, kind);
    if (i < 0) continue;
    if (seenMoves.has(i)) err(`${a.move} listed twice (${seenMoves.get(i)} and ${kind})`);
    seenMoves.set(i, kind);
    if (start[i]) {
      err(`${kind} ${a.move}: point is occupied (conflict)`);
      continue;
    }
    const r = play(start, i, me);
    if (!r.ok) {
      err(`${kind} ${a.move}: illegal move (${r.error})`);
      continue;
    }
    if (kind !== 'solution' && !a.text?.trim()) err(`${kind} ${a.move}: missing explanation`);
    const boards: Board[] = [start, r.board];
    if (a.reply?.length) {
      for (const mv of a.reply) checkPt(mv, `${kind} ${a.move} reply`);
      try {
        playSequence(r.board, opp, a.reply).forEach((f) => boards.push(f.board));
      } catch (e) {
        err(`${kind} ${a.move}: bad continuation: ${(e as Error).message}`);
        continue;
      }
    }
    for (const c of a.check ?? []) {
      const m = checkAssertion(c, boards);
      if (m) err(`${kind} ${a.move}: check failed: ${m}`);
    }
    let ok: boolean;
    try {
      ok = achievesGoal(p.goal, start, i, me);
    } catch (e) {
      err(`${kind} ${a.move}: goal check crashed: ${(e as Error).message}`);
      continue;
    }
    if (kind === 'solution' && !ok) err(`solution ${a.move} does not achieve goal ${p.goal.type}`);
    if (kind === 'wrong' && ok) err(`"wrong" ${a.move} actually achieves goal ${p.goal.type}`);
  }
  if (issues.some((x) => x.level === 'error')) return issues;

  // Ambiguity: every legal move that achieves the goal must be accepted.
  // Reading goals only consider moves near the goal stones (far moves cannot capture or save them).
  const reading = (p.goal.type === 'capture' && p.goal.read) || p.goal.type === 'escape' || p.goal.type === 'cut';
  const goalIdx = goalPoints(p).map((g) => parsePoint(g.pt));
  const near = (i: number) => {
    const [x, y] = toXY(i);
    return goalIdx.some((g) => {
      const [gx, gy] = toXY(g);
      return Math.max(Math.abs(gx - x), Math.abs(gy - y)) <= 3;
    });
  };
  // For forced captures only liberties of the target and points next to them can start the chase.
  let chaseCands: Set<number> | null = null;
  if (p.goal.type === 'capture' && p.goal.read) {
    chaseCands = new Set();
    for (const t of goalIdx) {
      const g = groupAt(start, t);
      for (const l of g?.liberties ?? []) {
        chaseCands.add(l);
        for (const n of neighbors(l)) if (!start[n]) chaseCands.add(n);
      }
    }
  }
  for (let i = 0; i < POINTS; i++) {
    if (start[i] || seenMoves.get(i) === 'solution' || seenMoves.get(i) === 'better') continue;
    if (reading && !near(i)) continue;
    if (chaseCands && !chaseCands.has(i)) continue;
    if (!play(start, i, me).ok) continue;
    let ok: boolean;
    try {
      ok = achievesGoal(p.goal, start, i, me);
    } catch (e) {
      err(`goal check crashed on ${pointOf(i)}: ${(e as Error).message}`);
      break;
    }
    if (ok) err(`ambiguous: ${pointOf(i)} also achieves goal ${p.goal.type} but is not accepted`);
  }

  // Coordinates mentioned in texts must be stones, moves, or points next to them.
  const relevant = new Set<number>();
  const addNear = (i: number) => {
    relevant.add(i);
    for (const n of neighbors(i)) relevant.add(n);
  };
  start.forEach((c, i) => c && addNear(i));
  for (const { a } of answersOf(p)) {
    addNear(parsePoint(a.move));
    (a.reply ?? []).forEach((m) => addNear(parsePoint(m)));
  }
  for (const t of p.goal.type === 'enclose' ? [] : textsOf(p)) {
    for (const m of t.matchAll(/\b([A-HJ][1-9])\b/g)) {
      if (!relevant.has(parsePoint(m[1]!))) warn(`text mentions ${m[1]}, which is far from every stone and move`);
    }
  }
  return issues;
}

function pointOf(i: number): string {
  const [x, y] = toXY(i);
  return `${'ABCDEFGHJ'[x]}${SIZE - y}`;
}

/** Canonical form under the 8 board symmetries and colour swap. */
function canonical(p: Problem): string {
  const b = boardFromLists(p.black, p.white).board;
  const variants: string[] = [];
  for (let s = 0; s < 8; s++) {
    for (const swap of [false, true]) {
      let str = '';
      for (let y = 0; y < SIZE; y++) {
        for (let x = 0; x < SIZE; x++) {
          let sx = s & 1 ? SIZE - 1 - x : x;
          let sy = s & 2 ? SIZE - 1 - y : y;
          if (s & 4) [sx, sy] = [sy, sx];
          const c = b[toIndex(sx, sy)];
          str += c === null || c === undefined ? '.' : (c === 'B') !== swap ? 'X' : 'O';
        }
      }
      variants.push(str + ((p.toPlay === 'B') !== swap ? 'X' : 'O'));
    }
  }
  return variants.sort()[0]!;
}

function stoneSet(key: string): Set<string> {
  const s = new Set<string>();
  for (let i = 0; i < key.length; i++) if (key[i] !== '.') s.add(`${i}${key[i]}`);
  return s;
}

export function validateSet(problems: Problem[], topics: Topic[]): Issue[] {
  const issues: Issue[] = [];
  const set = (level: Issue['level'], id: string, msg: string) => issues.push({ id, level, msg });

  if (problems.length !== EXPECTED_COUNT) set('error', '*', `expected ${EXPECTED_COUNT} problems, got ${problems.length}`);
  const ids = new Map<string, number>();
  problems.forEach((p) => ids.set(p.id, (ids.get(p.id) ?? 0) + 1));
  for (const [id, n] of ids) if (n > 1) set('error', id, `duplicate id (×${n})`);

  for (const p of problems) issues.push(...validateProblem(p, topics));

  // Topics must be contiguous and in course order.
  const order = topics.map((t) => t.id);
  let last = -1;
  for (const p of problems) {
    const ti = order.indexOf(p.topic);
    if (ti < last) set('error', p.id, `topic ${p.topic} appears after a later topic`);
    last = Math.max(last, ti);
  }

  // Terms must be introduced before use.
  const introducedAt = new Map<string, number>();
  topics.forEach((t, i) => t.terms.forEach((term) => introducedAt.set(term, i)));
  for (const [term, re] of Object.entries(TERM_PATTERNS)) {
    if (!introducedAt.has(term)) set('error', '*', `term "${term}" is never introduced by a topic`);
    topics.forEach((t, ti) => {
      if (t.intro.some((s) => re.test(s)) && (introducedAt.get(term) ?? 99) > ti)
        set('error', t.id, `topic intro uses "${term}" before it is introduced`);
    });
  }
  for (const p of problems) {
    const ti = order.indexOf(p.topic);
    for (const [term, re] of Object.entries(TERM_PATTERNS)) {
      if ((introducedAt.get(term) ?? 99) <= ti) continue;
      if (textsOf(p).some((t) => re.test(t))) set('error', p.id, `uses term "${term}" before it is introduced`);
    }
  }

  // Duplicates and near-duplicates.
  const canon = problems.map((p) => {
    try {
      return canonical(p);
    } catch {
      return '';
    }
  });
  for (let i = 0; i < problems.length; i++) {
    for (let j = i + 1; j < problems.length; j++) {
      if (!canon[i] || !canon[j]) continue;
      if (canon[i] === canon[j]) {
        set('error', problems[j]!.id, `same position as ${problems[i]!.id} (up to symmetry)`);
        continue;
      }
      const a = stoneSet(canon[i]!);
      const b = stoneSet(canon[j]!);
      const inter = [...a].filter((x) => b.has(x)).length;
      const jac = inter / (a.size + b.size - inter);
      const paired = problems[i]!.pair === problems[j]!.id || problems[j]!.pair === problems[i]!.id;
      if (jac >= 0.85 && !paired) set('warning', problems[j]!.id, `very similar to ${problems[i]!.id} (${Math.round(jac * 100)}%)`);
    }
  }
  return issues;
}
