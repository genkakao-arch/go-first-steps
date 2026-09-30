// Runtime move checking. Correctness comes only from the problem's predefined answers;
// the generic "try again" text is computed from the actual position, never guessed.

import type { Answer, Problem } from '../data/types';
import { type Board, type Cell, type Color, boardFromLists, groupAt, other, parsePoint, play, sameGroup } from './board';

export type Verdict = 'correct' | 'better' | 'wrong';

export interface Frame {
  board: Cell[];
  move: number;
  color: Color;
  captured: number[];
}

export type MoveOutcome =
  | { kind: 'illegal'; reason: 'occupied' | 'suicide' }
  | { kind: 'move'; verdict: Verdict; frames: Frame[]; text: string; answer: Answer | null };

export function startBoard(p: Problem): Cell[] {
  return boardFromLists(p.black, p.white).board;
}

/** Plays `first` for p.toPlay followed by the reply sequence (alternating colours). */
export function playSequence(start: Board, toPlay: Color, moves: string[]): Frame[] {
  const frames: Frame[] = [];
  let b: Board = start;
  let color = toPlay;
  for (const mv of moves) {
    const i = parsePoint(mv);
    const r = play(b, i, color);
    if (!r.ok) throw new Error(`illegal move ${mv} for ${color}: ${r.error}`);
    frames.push({ board: r.board, move: i, color, captured: r.captured });
    b = r.board;
    color = other(color);
  }
  return frames;
}

function findAnswer(list: Answer[] | undefined, point: number): Answer | null {
  return list?.find((a) => parsePoint(a.move) === point) ?? null;
}

export function libertiesWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'свобода';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'свободы';
  return 'свобод';
}

export function sideName(c: Color, form: 'nom' | 'gen' = 'nom'): string {
  if (form === 'gen') return c === 'B' ? 'чёрных' : 'белых';
  return c === 'B' ? 'чёрные' : 'белые';
}

function libs(b: Board, pt: string): number | null {
  const g = groupAt(b, parsePoint(pt));
  return g ? g.liberties.length : null;
}

function canJoinInOneMove(b: Board, a: number, c: number, color: Color): boolean {
  for (let i = 0; i < b.length; i++) {
    if (b[i]) continue;
    const r = play(b, i, color);
    if (r.ok && sameGroup(r.board, a, c)) return true;
  }
  return false;
}

/** Explanation for a move that is not among the problem's answers. Facts only. */
export function genericMiss(p: Problem, after: Board, move: number): string {
  const me = p.toPlay;
  const opp = other(me);
  const g = p.goal;
  const own = groupAt(after, move);
  const selfAtari = own && own.liberties.length === 1 ? ' Кроме того, у твоего нового камня осталась всего одна свобода — его могут сразу захватить.' : '';
  switch (g.type) {
    case 'capture': {
      const left = g.targets.find((t) => after[parsePoint(t)] === opp);
      if (!left) return 'Этот ход не решает задачу.';
      const n = libs(after, left)!;
      return `Захвата нет: у ${sideName(opp, 'gen')} камней осталось ${n} ${libertiesWord(n)}.${selfAtari}`;
    }
    case 'atari': {
      const n = libs(after, g.target);
      if (n === null) return 'Этот ход не решает задачу.';
      if (n === 1) return `Атари получилось, но твой камень сам в опасности: у него одна свобода.`;
      return `У ${sideName(opp, 'gen')} сейчас ${n} ${libertiesWord(n)}. Атари — это когда свобода остаётся ровно одна.${selfAtari}`;
    }
    case 'double-atari': {
      const inAtari = g.targets.filter((t) => libs(after, t) === 1).length;
      if (inAtari === 1) return `Атари только одной группе — белые просто спасут её.${selfAtari}`;
      return `Атари нет ни одной группе.${selfAtari}`;
    }
    case 'escape': {
      const n = libs(after, g.target);
      if (n === null) return 'Этот ход не решает задачу.';
      if (n <= 1) return `Твои камни всё ещё в атари: у них ${n} ${libertiesWord(n)}.`;
      if (n === 2) return `У твоей группы всего 2 свободы — соперник снова поставит атари.`;
      return `Этот ход не спасает камни надёжно.`;
    }
    case 'connect':
      return `Эти камни пока не стали одной группой: соперник может встать между ними.${selfAtari}`;
    case 'cut': {
      const [a, c] = g.stones.map(parsePoint) as [number, number];
      if (canJoinInOneMove(after, a, c, opp)) return `${cap(sideName(opp))} всё ещё могут соединить свои камни одним ходом.`;
      return `Твой разрезающий камень слишком слабый — его можно поймать.`;
    }
    case 'live':
      return `После этого хода ${sideName(opp)} смогут не дать тебе сделать два глаза.`;
    case 'kill':
      return `После этого хода ${sideName(opp)} смогут сделать два глаза.`;
    case 'enclose':
      return `Граница ещё не закрыта: ${sideName(opp)} смогут пройти внутрь.`;
  }
}

function cap(s: string): string {
  return s.charAt(0).toUpperCase() + s.slice(1);
}

export function evaluateMove(p: Problem, start: Board, point: number): MoveOutcome {
  const first = play(start, point, p.toPlay);
  if (!first.ok) return { kind: 'illegal', reason: first.error === 'occupied' ? 'occupied' : 'suicide' };
  const firstFrame: Frame = { board: first.board, move: point, color: p.toPlay, captured: first.captured };

  const withReply = (a: Answer): Frame[] => [
    firstFrame,
    ...(a.reply ? playSequence(first.board, other(p.toPlay), a.reply) : []),
  ];

  const sol = findAnswer(p.solutions, point);
  if (sol) return { kind: 'move', verdict: 'correct', frames: withReply(sol), text: sol.text ?? p.explanation, answer: sol };
  const better = findAnswer(p.better, point);
  if (better) return { kind: 'move', verdict: 'better', frames: withReply(better), text: better.text ?? '', answer: better };
  const wrong = findAnswer(p.wrong, point);
  if (wrong) return { kind: 'move', verdict: 'wrong', frames: withReply(wrong), text: wrong.text ?? '', answer: wrong };
  return { kind: 'move', verdict: 'wrong', frames: [firstFrame], text: genericMiss(p, first.board, point), answer: null };
}

/** Frames for "show solution": the first listed solution with its continuation. */
export function solutionFrames(p: Problem, start: Board): Frame[] {
  const s = p.solutions[0]!;
  return playSequence(start, p.toPlay, [s.move, ...(s.reply ?? [])]);
}
