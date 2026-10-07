// In-game coach. Every sentence is either a fact checked on the board (atari, capture,
// rescue, connection) or KataGo's own estimate in points; nothing is guessed.

import { type Board, type Color, type Group, allGroups, groupAt, other, play, pointName } from '../go/board';
import { PASS, type GameState, type SearchResult } from '../katago/search';
import { type Zone, goodZone } from './zones';

export type NoteKind = 'good' | 'inaccuracy' | 'mistake' | 'warning' | 'info';

export interface CoachNote {
  kind: NoteKind;
  title: string;
  text: string;
  /** KataGo's better move — shown only after "Показать точный ход". */
  mark?: number;
  /** Area to highlight instead of naming the point. */
  zone?: Zone;
  /** Text that names the exact move, revealed on request. */
  reveal?: string;
  /** Details that name the exact move, replacing `details` once revealed. */
  revealDetails?: string[];
  /** Estimated points lost by the move, when known. */
  loss?: number;
  /** Longer explanation, one sentence per item. */
  details?: string[];
  /** Variations that can be stepped through on the board. */
  lines?: { label: string; from: GameState; moves: number[]; hidden?: boolean }[];
}

/** Point loss from which a move is reported at all ("только важное"). */
export const REPORT_LOSS = 3;
const MISTAKE_LOSS = 6;
/** Tactical facts are only blamed when KataGo also sees a real loss. */
const TACTIC_LOSS = 2;

export function stonesWord(n: number): string {
  const m10 = n % 10;
  const m100 = n % 100;
  if (m10 === 1 && m100 !== 11) return 'камень';
  if (m10 >= 2 && m10 <= 4 && (m100 < 12 || m100 > 14)) return 'камня';
  return 'камней';
}

function libertiesWord(n: number): string {
  return n === 1 ? 'свобода' : n >= 2 && n <= 4 ? 'свободы' : 'свобод';
}

/** "твой камень D4", "белую группу из 3 камней у D4" — owner and grammatical case. */
export function groupPhrase(g: Group, owner: 'mine' | 'white', grammaticalCase: 'nom' | 'acc'): string {
  const anchor = pointName(Math.min(...g.stones));
  if (g.stones.length === 1) return `${owner === 'mine' ? 'твой' : 'белый'} камень ${anchor}`;
  const adj =
    owner === 'mine' ? (grammaticalCase === 'nom' ? 'твоя' : 'твою') : grammaticalCase === 'nom' ? 'белая' : 'белую';
  const noun = grammaticalCase === 'nom' ? 'группа' : 'группу';
  const n = g.stones.length;
  // Genitive after «из»: «из 2 камней», «из 21 камня».
  const gen = n % 10 === 1 && n % 100 !== 11 ? 'камня' : 'камней';
  return `${adj} ${noun} из ${n} ${gen} у ${anchor}`;
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1);
const was = (g: Group) => (g.stones.length === 1 ? 'был' : 'была');

/** Groups of `color` with one liberty that the opponent can legally take. */
export function groupsInAtari(b: Board, color: Color): Group[] {
  return allGroups(b).filter(
    (g) => g.color === color && g.liberties.length === 1 && play(b, g.liberties[0]!, other(color)).ok,
  );
}

export interface MoveEffect {
  captured: number[];
  /** Own groups that were in atari before and have 2+ liberties after. */
  saved: Group[];
  /** Opponent groups put into atari by the move. */
  atari: Group[];
  /** The move joined two or more of our groups. */
  connected: boolean;
}

export function moveEffect(b: Board, move: number, color: Color): MoveEffect | null {
  if (move === PASS) return null;
  const r = play(b, move, color);
  if (!r.ok) return null;
  const after = r.board;
  const ownBefore = allGroups(b).filter((g) => g.color === color);
  const touching = ownBefore.filter((g) => g.liberties.includes(move));
  const saved = touching.filter((g) => g.liberties.length === 1 && (groupAt(after, g.stones[0]!)?.liberties.length ?? 0) >= 2);
  const oppBefore = new Map<number, number>();
  for (const g of allGroups(b)) if (g.color !== color) for (const s of g.stones) oppBefore.set(s, g.liberties.length);
  const atari = allGroups(after).filter(
    (g) => g.color !== color && g.liberties.length === 1 && (oppBefore.get(g.stones[0]!) ?? 0) > 1,
  );
  return { captured: r.captured, saved, atari, connected: touching.length >= 2 };
}

function lossOf(move: number, before: SearchResult | null, afterForOpponent: SearchResult): number | null {
  if (!before) return null;
  const best = before.moves[0];
  if (!best) return null;
  const stat = before.moves.find((m) => m.move === move && m.visits >= 8);
  // Prefer the root-move statistics; fall back to the opponent's search after the move.
  const leadAfter = stat ? stat.lead : -afterForOpponent.lead;
  return Math.max(0, best.lead - leadAfter);
}

const round = (x: number) => Math.round(x);

/** Why KataGo's better move is better, from what it does on the board (names the point). */
function bestMoveReason(b: Board, best: number, color: Color): string | null {
  const e = moveEffect(b, best, color);
  if (!e) return null;
  const at = pointName(best);
  if (e.captured.length > 0) return `${at} захватывает ${e.captured.length} ${stonesWord(e.captured.length)}.`;
  if (e.saved.length > 0) return `${at} спасает ${groupPhrase(e.saved[0]!, 'mine', 'acc')} из атари.`;
  if (e.atari.length > 0) return `${at} ставит атари: ${groupPhrase(e.atari[0]!, 'white', 'nom')} остаётся с одной свободой.`;
  if (e.connected) return `${at} соединяет твои камни в одну группу.`;
  return null;
}

/** What to look for in the highlighted area, without naming the point. */
export function areaReason(b: Board, best: number, color: Color): string {
  const e = moveEffect(b, best, color);
  if (e?.captured.length) return 'Там можно захватить камни.';
  if (e?.saved.length) return 'Там твоей группе нужна помощь.';
  if (e?.atari.length) return 'Там можно поставить атари.';
  if (e?.connected) return 'Там стоит соединить свои камни.';
  return 'Подумай, что там важнее: своя территория, чужая территория или сила групп.';
}

export function judgeUserMove(args: {
  before: GameState;
  move: number;
  analysisBefore: SearchResult | null;
  analysisAfter: SearchResult;
}): CoachNote | null {
  const { before, move, analysisBefore, analysisAfter } = args;
  const me = before.toPlay;
  const opp = other(me);
  const b = before.board;
  const loss = lossOf(move, analysisBefore, analysisAfter);
  const best = analysisBefore?.moves[0]?.move;
  const zone = goodZone(analysisBefore) ?? undefined;
  const where = zone ? ` Посмотри в подсвеченной области: ${zone.name}.` : '';
  const severity = (l: number): NoteKind => (l >= MISTAKE_LOSS ? 'mistake' : 'inaccuracy');
  const title = (k: NoteKind) => (k === 'mistake' ? 'Ошибка' : 'Неточность');
  const lossText = (l: number) => `По оценке KataGo это стоит около ${round(l)} ${round(l) === 1 ? 'очка' : 'очков'}.`;
  const exact = (extra?: string | null) => `Точный ход KataGo: ${pointName(best!)}.${extra ? ` ${extra}` : ''}`;

  if (move === PASS) {
    if (loss !== null && loss >= REPORT_LOSS && best !== undefined && best !== PASS) {
      return {
        kind: severity(loss),
        title: 'Рано пасовать',
        text: `На доске ещё есть полезные ходы. ${lossText(loss)}${where}`,
        mark: best,
        zone,
        reveal: exact(),
        loss,
      };
    }
    return null;
  }

  const eff = moveEffect(b, move, me);
  const after = play(b, move, me);
  if (!eff || !after.ok) return null;
  const own = groupAt(after.board, move)!;
  const bestDiffers = best !== undefined && best !== move && best !== PASS;

  // 1. The move leaves its own group in atari.
  if (loss !== null && loss >= TACTIC_LOSS && own.liberties.length === 1 && play(after.board, own.liberties[0]!, opp).ok) {
    const k = severity(loss);
    return {
      kind: k,
      title: title(k),
      text: `После этого хода у твоей группы осталась одна свобода — белые могут сразу её захватить. ${lossText(loss)}${bestDiffers ? where : ''}`,
      mark: bestDiffers ? best : undefined,
      zone: bestDiffers ? zone : undefined,
      reveal: bestDiffers ? exact(bestMoveReason(b, best!, me)) : undefined,
      loss,
    };
  }

  // 2. A capture was available and KataGo wanted it.
  if (loss !== null && loss >= TACTIC_LOSS && bestDiffers && eff.captured.length === 0) {
    const bestEff = moveEffect(b, best!, me);
    if (bestEff && bestEff.captured.length > 0) {
      const k = severity(loss);
      return {
        kind: k,
        title: title(k),
        text: `Можно было захватить ${bestEff.captured.length} ${stonesWord(bestEff.captured.length)}: у них оставалась одна свобода. ${lossText(loss)}${where}`,
        mark: best,
        zone,
        reveal: exact(),
        loss,
      };
    }
    // 3. Our group was in atari and needed saving.
    if (bestEff && bestEff.saved.length > 0 && eff.saved.length === 0) {
      const k = severity(loss);
      const g = bestEff.saved[0]!;
      return {
        kind: k,
        title: title(k),
        text: `${cap(groupPhrase(g, 'mine', 'nom'))} ${was(g)} в атари — ${g.stones.length === 1 ? 'его' : 'её'} стоило спасти. ${lossText(loss)}`,
        mark: best,
        zone,
        reveal: exact(),
        loss,
      };
    }
  }

  // 4. A plain loss in points.
  if (loss !== null && loss >= REPORT_LOSS && bestDiffers) {
    const k = severity(loss);
    return {
      kind: k,
      title: title(k),
      text: `${lossText(loss)} Сильнее было играть в другом месте.${where} ${areaReason(b, best!, me)}`,
      mark: best,
      zone,
      reveal: exact(bestMoveReason(b, best!, me)),
      loss,
    };
  }

  // 5. Praise only for notable good moves.
  if (loss === null || loss < 1.5) {
    if (eff.captured.length > 0)
      return { kind: 'good', title: 'Захват!', text: `Ты снял ${eff.captured.length} ${stonesWord(eff.captured.length)}.` };
    if (eff.saved.length > 0)
      return {
        kind: 'good',
        title: 'Хорошо',
        text: `Группа спасена из атари: теперь у неё ${own.liberties.length} ${libertiesWord(own.liberties.length)}.`,
      };
  }
  return null;
}

/** What KataGo's reply did that the learner must notice. */
export function noteEngineMove(before: GameState, move: number): CoachNote | null {
  if (move === PASS) {
    return { kind: 'info', title: 'KataGo пасует', text: 'Если тебе тоже нечего добавить — пасуй, и партия закончится подсчётом.' };
  }
  const me = other(before.toPlay); // the learner
  const r = play(before.board, move, before.toPlay);
  if (!r.ok) return null;
  if (r.captured.length > 0) {
    return {
      kind: 'warning',
      title: 'Белые захватили',
      text: `Ход ${pointName(move)} снял ${r.captured.length} ${stonesWord(r.captured.length)}.`,
    };
  }
  const wasInAtari = new Set(groupsInAtari(before.board, me).flatMap((g) => g.stones));
  const fresh = groupsInAtari(r.board, me).filter((g) => !g.stones.some((s) => wasInAtari.has(s)));
  if (fresh.length > 0) {
    const g = fresh.sort((a, c) => c.stones.length - a.stones.length)[0]!;
    return {
      kind: 'warning',
      title: 'Атари!',
      text: `${cap(groupPhrase(g, 'mine', 'nom'))} в атари: осталась одна свобода. Спаси или реши, что спасать не стоит.`,
    };
  }
  return null;
}

export interface PositionView {
  lines: string[];
  zone?: Zone;
  /** KataGo's move, revealed on request. */
  mark?: number;
  reveal?: string;
}

/** "Что здесь происходит?" — facts about the position and the area where good moves are. */
export function describePosition(s: GameState, analysis: SearchResult | null): PositionView {
  const me = s.toPlay;
  const opp = other(me);
  const lines: string[] = [];
  if (analysis) {
    const lead = analysis.lead;
    const pct = Math.round(analysis.winrate * 100);
    lines.push(
      Math.abs(lead) < 1
        ? `По оценке KataGo силы равны (твои шансы ${pct}%).`
        : `По оценке KataGo ты ${lead > 0 ? 'впереди' : 'отстаёшь'} примерно на ${round(Math.abs(lead))} ${round(Math.abs(lead)) === 1 ? 'очко' : 'очков'} (твои шансы ${pct}%).`,
    );
  }
  for (const g of groupsInAtari(s.board, me)) lines.push(`${cap(groupPhrase(g, 'mine', 'nom'))} в атари: осталась одна свобода.`);
  for (const g of groupsInAtari(s.board, opp))
    lines.push(`${cap(groupPhrase(g, 'white', 'nom'))} в атари — ${g.stones.length === 1 ? 'его' : 'её'} можно захватить.`);
  for (const g of allGroups(s.board).filter((x) => x.color === me && x.liberties.length === 2 && x.stones.length >= 2))
    lines.push(`У твоей группы у ${pointName(Math.min(...g.stones))} всего 2 свободы — следи за атари.`);
  const best = analysis?.moves[0]?.move;
  if (best === PASS) {
    lines.push('KataGo считает, что полезных ходов не осталось — можно пасовать.');
    return { lines };
  }
  const zone = goodZone(analysis) ?? undefined;
  if (zone && best !== undefined) {
    lines.push(`Хорошие ходы сейчас — в области: ${zone.name} (подсвечено). ${areaReason(s.board, best, me)}`);
    return { lines, zone, mark: best, reveal: `KataGo сыграл бы ${pointName(best)}.` };
  }
  return { lines };
}
