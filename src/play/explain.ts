// Turns KataGo's judgement into human explanations. Sources, all checkable:
//  - tactics on the board (capture, atari, rescue, connection, cut) from our rules engine;
//  - KataGo's ownership map before/after a move (who will own which area, which groups live);
//  - KataGo's expected continuation (principal variation).

import { type Board, type Color, type Group, SIZE, allGroups, neighbors, other, pointName, toXY } from '../go/board';
import { PASS } from '../katago/search';
import { groupPhrase, moveEffect, stonesWord } from './coach';

export type Ownership = readonly number[];

// ---------------------------------------------------------------- regions

const COLS = ['left', 'center', 'right'] as const;
const ROWS = ['top', 'middle', 'bottom'] as const;

const REGION_NAMES: Record<string, { nom: string; acc: string }> = {
  'left-top': { nom: 'левый верхний угол', acc: 'левый верхний угол' },
  'center-top': { nom: 'верхняя сторона', acc: 'верхнюю сторону' },
  'right-top': { nom: 'правый верхний угол', acc: 'правый верхний угол' },
  'left-middle': { nom: 'левая сторона', acc: 'левую сторону' },
  'center-middle': { nom: 'центр', acc: 'центр' },
  'right-middle': { nom: 'правая сторона', acc: 'правую сторону' },
  'left-bottom': { nom: 'левый нижний угол', acc: 'левый нижний угол' },
  'center-bottom': { nom: 'нижняя сторона', acc: 'нижнюю сторону' },
  'right-bottom': { nom: 'правый нижний угол', acc: 'правый нижний угол' },
};

export function regionOf(point: number): string {
  const [x, y] = toXY(point);
  const band = (v: number) => (v <= 2 ? 0 : v <= 5 ? 1 : 2);
  return `${COLS[band(x)]}-${ROWS[band(y)]}`;
}

export function regionName(key: string, grammaticalCase: 'nom' | 'acc' = 'nom'): string {
  return REGION_NAMES[key]![grammaticalCase];
}

const sign = (me: Color) => (me === 'B' ? 1 : -1);

/** Expected points for `me` per region, from an ownership map (black perspective). */
function regionTotals(o: Ownership, me: Color): Map<string, number> {
  const m = new Map<string, number>();
  for (let i = 0; i < SIZE * SIZE; i++) {
    const k = regionOf(i);
    m.set(k, (m.get(k) ?? 0) + (o[i] ?? 0) * sign(me));
  }
  return m;
}

export interface RegionDelta {
  region: string;
  /** Points gained by `me` going from A to B (negative = lost). */
  delta: number;
}

export function regionDeltas(a: Ownership, b: Ownership, me: Color): RegionDelta[] {
  const ta = regionTotals(a, me);
  const tb = regionTotals(b, me);
  return [...tb.keys()]
    .map((region) => ({ region, delta: (tb.get(region) ?? 0) - (ta.get(region) ?? 0) }))
    .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta));
}

// ----------------------------------------------------------------- groups

export type Status = 'safe' | 'unsettled' | 'dead';

function statusOf(g: Group, o: Ownership): Status {
  const s = g.color === 'B' ? 1 : -1;
  const mean = g.stones.reduce((acc, p) => acc + (o[p] ?? 0) * s, 0) / g.stones.length;
  return mean > 0.5 ? 'safe' : mean < -0.5 ? 'dead' : 'unsettled';
}

export interface GroupChange {
  group: Group;
  from: Status;
  to: Status;
}

/** Groups on `board` whose life status differs between ownership maps A and B. Biggest first. */
export function groupChanges(board: Board, a: Ownership, b: Ownership): GroupChange[] {
  return allGroups(board)
    .map((group) => ({ group, from: statusOf(group, a), to: statusOf(group, b) }))
    .filter((c) => c.from !== c.to)
    .sort((x, y) => y.group.stones.length - x.group.stones.length);
}

const RANK: Record<Status, number> = { dead: 0, unsettled: 1, safe: 2 };

/** Does this change help `side` (its own group got safer, or an enemy group got weaker)? */
function helps(c: GroupChange, side: Color): boolean {
  const improved = RANK[c.to] > RANK[c.from];
  return c.group.color === side ? improved : !improved;
}

function describeChange(c: GroupChange, me: Color): string {
  const mine = c.group.color === me;
  const who = groupPhrase(c.group, mine ? 'mine' : 'white', 'nom');
  const better = (c.from === 'dead' && c.to !== 'dead') || (c.from === 'unsettled' && c.to === 'safe');
  const verb =
    c.to === 'dead'
      ? 'обречена: KataGo считает её мёртвой'
      : c.to === 'safe'
        ? 'теперь в безопасности'
        : better
          ? 'получает шанс выжить'
          : 'оказывается под угрозой';
  const text = `${who} ${verb}`;
  // Grammatical gender: "камень … обречён".
  return c.group.stones.length === 1 ? text.replace('обречена: KataGo считает её мёртвой', 'обречён: KataGo считает его мёртвым') : text;
}

// ----------------------------------------------------------------- tactics

/** Does `move` separate groups of `victim` that touched the point (a cut)? */
function cutsGroups(b: Board, move: number, victim: Color): number {
  const ids = new Set<number>();
  const groups = allGroups(b).filter((g) => g.color === victim);
  for (const n of neighbors(move)) {
    const gi = groups.findIndex((g) => g.stones.includes(n));
    if (gi >= 0) ids.add(gi);
  }
  return ids.size;
}

/** What a move does tactically, in one clause, or null. */
export function tacticalClause(b: Board, move: number, color: Color, learner: Color): string | null {
  if (move === PASS) return null;
  const e = moveEffect(b, move, color);
  if (!e) return null;
  const mine = color === learner;
  if (e.captured.length > 0) return `захватывает ${e.captured.length} ${stonesWord(e.captured.length)}`;
  if (e.saved.length > 0) {
    const g = e.saved[0]!;
    return `спасает ${groupPhrase(g, mine ? 'mine' : 'white', 'acc')} из атари`;
  }
  if (e.atari.length > 0) {
    const g = e.atari[0]!;
    return `ставит атари: ${groupPhrase(g, mine ? 'white' : 'mine', 'nom')} остаётся с одной свободой`;
  }
  if (cutsGroups(b, move, other(color)) >= 2) return mine ? 'разрезает белые камни' : 'разрезает твои камни';
  if (e.connected) return mine ? 'соединяет твои камни' : 'соединяет свои камни';
  return null;
}

/** "около 3 очков": genitive after «около». */
const ptsGen = (n: number) => {
  const r = Math.round(Math.abs(n));
  return `${r} ${r % 10 === 1 && r % 100 !== 11 ? 'очка' : 'очков'}`;
};

const pts = (n: number) => {
  const r = Math.round(Math.abs(n));
  return `${r} ${r % 10 === 1 && r % 100 !== 11 ? 'очко' : r % 10 >= 2 && r % 10 <= 4 && (r % 100 < 12 || r % 100 > 14) ? 'очка' : 'очков'}`;
};

// ------------------------------------------------------------ explanations

/**
 * Why a single move was played: what changed between the ownership before it (`a`)
 * and after it (`b`). Written from the learner's point of view.
 */
export function explainMove(args: {
  board: Board;
  move: number;
  color: Color;
  learner: Color;
  before: Ownership | null;
  after: Ownership | null;
}): string[] {
  const { board, move, color, learner } = args;
  const out: string[] = [];
  if (move === PASS) return ['Пас: KataGo считает, что полезных ходов больше нет.'];
  const tac = tacticalClause(board, move, color, learner);
  if (tac) out.push(`${cap(tac)}.`);
  if (args.before && args.after) {
    // Only groups that already stood on the board: a stone that was just placed has no "before".
    // Explain the move by what it achieves for the side that played it; skip groups the
    // tactical clause already talked about (the one put in atari or rescued).
    const eff = moveEffect(board, move, color);
    const told = new Set([...(eff?.atari ?? []), ...(eff?.saved ?? [])].flatMap((g) => g.stones));
    const change = groupChanges(board, args.before, args.after).find(
      (c) => helps(c, color) && !c.group.stones.some((p) => told.has(p)),
    );
    if (change) out.push(`${cap(describeChange(change, learner))}.`);
    const top = regionDeltas(args.before, args.after, color)[0];
    if (top && top.delta >= 2 && out.length < 2) {
      // Was the area leaning to the other side before? Then the move takes it away.
      const ownedBefore = regionDeltas(new Array<number>(SIZE * SIZE).fill(0), args.before, color).find((d) => d.region === top.region);
      const takes = (ownedBefore?.delta ?? 0) < -1;
      const verb = color === learner ? (takes ? 'Ты отнимаешь' : 'Ты занимаешь') : takes ? 'Белые отнимают' : 'Белые занимают';
      out.push(`${verb} ${regionName(top.region, 'acc')}: около ${ptsGen(top.delta)} по оценке KataGo.`);
    }
  }
  if (out.length === 0) out.push('Спокойный ход: заметных изменений в группах и территории KataGo здесь не видит.');
  return out;
}

/**
 * Why `best` is better than the learner's `move`: compares where each line leads.
 * `bestEnd` / `moveEnd` are KataGo's ownership maps at the end of each expected continuation.
 */
export function explainComparison(args: {
  board: Board;
  learner: Color;
  move: number;
  best: number;
  bestEnd: Ownership;
  moveEnd: Ownership;
  loss: number;
}): string[] {
  const { board, learner, move, best, bestEnd, moveEnd } = args;
  const out: string[] = [];
  const tac = tacticalClause(board, best, learner, learner);
  if (tac) out.push(`${pointName(best)} ${tac}.`);
  // A group whose fate is worse for the learner after the played move than after the best one.
  const fate = groupChanges(board, bestEnd, moveEnd).find((c) => helps(c, other(learner)));
  if (fate) {
    const mine = fate.group.color === learner;
    const who = groupPhrase(fate.group, mine ? 'mine' : 'white', 'nom');
    const single = fate.group.stones.length === 1;
    const statusWord = (s: Status) =>
      s === 'safe' ? (single ? 'живой' : 'живая') : s === 'dead' ? (single ? 'мёртвый' : 'мёртвая') : 'под угрозой';
    out.push(
      `${cap(who)}: после ${pointName(best)} — ${statusWord(fate.from)}, после ${move === PASS ? 'паса' : pointName(move)} — ${statusWord(fate.to)}.`,
    );
  }
  const d = regionDeltas(moveEnd, bestEnd, learner)[0];
  if (d && d.delta >= 2 && out.length < 3) {
    const yours = regionName(d.region).includes('сторона') ? 'твоей' : 'твоим';
    out.push(`После ${pointName(best)} ${regionName(d.region)} получается ${yours} примерно на ${pts(d.delta)} больше.`);
  }
  if (out.length === 0) out.push(`KataGo оценивает разницу в ${pts(args.loss)}, но она распределена по всей доске.`);
  return out;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
