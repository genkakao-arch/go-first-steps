// Authoring helper: explore a problem position.
//   npx tsx scripts/pv.ts <id>                 — list moves that achieve the goal
//   npx tsx scripts/pv.ts <id> <move> [...]    — play moves and show the board + liberties
import { boardFromLists, boardToDiagram, other, parsePoint, play, pointName, POINTS, groupAt, type Board } from '../src/go/board';
import { PROBLEMS } from '../src/data/problems';
import { achievesGoal } from '../src/go/verify';
import { canEscape } from '../src/go/reading';

const args = process.argv.slice(2);
const pvAt = args.indexOf('--pv');
const [id, ...moves] = pvAt >= 0 ? args.slice(0, pvAt) : args;
const p = PROBLEMS.find((x) => x.id === id);
if (!p) throw new Error(`no problem ${id}`);
let b: Board = boardFromLists(p.black, p.white).board;

function show(bd: Board) {
  boardToDiagram(bd).forEach((r, i) => console.log(`${9 - i} ${r.split('').join(' ')}`));
  console.log('  A B C D E F G H J');
}

if (!moves.length) {
  show(b);
  const ok: string[] = [];
  for (let i = 0; i < POINTS; i++) if (!b[i] && achievesGoal(p.goal, b, i, p.toPlay)) ok.push(pointName(i));
  console.log('goal moves:', ok.join(' ') || '(none)');
} else {
  let c = p.toPlay;
  for (const m of moves) {
    const r = play(b, parsePoint(m), c);
    if (!r.ok) throw new Error(`${m}: ${r.error}`);
    b = r.board;
    console.log(`${c} ${m}${r.captured.length ? ' captures ' + r.captured.map(pointName).join(',') : ''}`);
    c = other(c);
  }
  show(b);
  const seen = new Set<number>();
  for (let i = 0; i < POINTS; i++) {
    if (!b[i] || seen.has(i)) continue;
    const g = groupAt(b, i)!;
    g.stones.forEach((s) => seen.add(s));
    console.log(`${g.color} ${g.stones.map(pointName).join(',')}: libs ${g.liberties.map(pointName).join(',')}`);
  }
}

// With --pv <move>: print a forced capture line for a read-capture goal.
const pvIdx = process.argv.indexOf('--pv');
if (pvIdx >= 0 && p.goal.type === 'capture') {
  const t = parsePoint(p.goal.targets[0]!);
  let bd: Board = boardFromLists(p.black, p.white).board;
  const line: string[] = [];
  let mv = parsePoint(process.argv[pvIdx + 1]!);
  for (let step = 0; step < 40; step++) {
    const r = play(bd, mv, p.toPlay);
    if (!r.ok) break;
    bd = r.board;
    line.push(pointName(mv));
    if (!bd[t]) break;
    // Defender: the move that survives longest (prefer extending).
    const g = groupAt(bd, t)!;
    const cands = [...g.liberties];
    let best: { m: number; b: Board } | null = null;
    for (const m of cands) {
      const rr = play(bd, m, other(p.toPlay));
      if (rr.ok && (!best || groupAt(rr.board, t)!.liberties.length > groupAt(best.b, t)!.liberties.length)) best = { m, b: rr.board };
    }
    if (!best) break;
    bd = best.b;
    line.push(pointName(best.m));
    // Attacker: first move after which the target cannot escape.
    let next = -1;
    const libs = groupAt(bd, t)!.liberties;
    const order = [...libs, ...Array.from({ length: POINTS }, (_, i) => i).filter((i) => !libs.includes(i))];
    for (const m of order) {
      if (bd[m]) continue;
      const rr = play(bd, m, p.toPlay);
      if (rr.ok && (!rr.board[t] || !canEscape(rr.board, t, { depth: 30, maxLibs: 3 }))) { next = m; break; }
    }
    if (next < 0) { console.log('no forced continuation'); break; }
    mv = next;
  }
  console.log('PV:', line.join(' '));
}
