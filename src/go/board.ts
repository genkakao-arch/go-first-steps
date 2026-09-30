// Minimal Go rules for a 9×9 board: groups, liberties, captures, illegal moves.
// Ko is intentionally not modelled: no problem in the course relies on it.

export const SIZE = 9;
export const POINTS = SIZE * SIZE;

export type Color = 'B' | 'W';
export type Cell = Color | null;
export type Board = readonly Cell[];

// Standard Go column letters (no "I").
const COLS = 'ABCDEFGHJ';

export function other(c: Color): Color {
  return c === 'B' ? 'W' : 'B';
}

export function toIndex(x: number, y: number): number {
  return y * SIZE + x;
}

/** x: 0..8 left→right, y: 0..8 top→bottom (row 9 is y=0). */
export function toXY(i: number): [number, number] {
  return [i % SIZE, Math.floor(i / SIZE)];
}

/** "C3" → index, or -1 when the coordinate is malformed / off-board. */
export function parsePoint(s: string): number {
  const m = /^([A-HJ])([1-9])$/.exec(s.trim().toUpperCase());
  if (!m) return -1;
  const x = COLS.indexOf(m[1]!);
  const row = Number(m[2]);
  return toIndex(x, SIZE - row);
}

export function pointName(i: number): string {
  const [x, y] = toXY(i);
  return `${COLS[x]}${SIZE - y}`;
}

export function colLabel(x: number): string {
  return COLS[x]!;
}

const NEIGHBORS: number[][] = Array.from({ length: POINTS }, (_, i) => {
  const [x, y] = toXY(i);
  const n: number[] = [];
  if (x > 0) n.push(i - 1);
  if (x < SIZE - 1) n.push(i + 1);
  if (y > 0) n.push(i - SIZE);
  if (y < SIZE - 1) n.push(i + SIZE);
  return n;
});

export function neighbors(i: number): readonly number[] {
  return NEIGHBORS[i]!;
}

export function emptyBoard(): Cell[] {
  return new Array<Cell>(POINTS).fill(null);
}

/** Rows from top (row 9) to bottom (row 1); X = black, O = white, . = empty. */
export function parseDiagram(rows: readonly string[]): Cell[] {
  if (rows.length !== SIZE) throw new Error(`diagram must have ${SIZE} rows, got ${rows.length}`);
  const b = emptyBoard();
  rows.forEach((row, y) => {
    const r = row.replace(/\s+/g, '');
    if (r.length !== SIZE) throw new Error(`row ${SIZE - y} must have ${SIZE} points, got ${r.length}`);
    for (let x = 0; x < SIZE; x++) {
      const ch = r[x];
      if (ch === 'X') b[toIndex(x, y)] = 'B';
      else if (ch === 'O') b[toIndex(x, y)] = 'W';
      else if (ch !== '.') throw new Error(`unknown symbol "${ch}" in row ${SIZE - y}`);
    }
  });
  return b;
}

export interface Group {
  color: Color;
  stones: number[];
  liberties: number[];
}

export function groupAt(b: Board, i: number): Group | null {
  const color = b[i];
  if (!color) return null;
  const stones: number[] = [];
  const libs = new Set<number>();
  const seen = new Set<number>([i]);
  const stack = [i];
  while (stack.length) {
    const p = stack.pop()!;
    stones.push(p);
    for (const n of neighbors(p)) {
      const c = b[n];
      if (c === null) libs.add(n);
      else if (c === color && !seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return { color, stones, liberties: [...libs] };
}

export function allGroups(b: Board): Group[] {
  const seen = new Set<number>();
  const groups: Group[] = [];
  for (let i = 0; i < POINTS; i++) {
    if (!b[i] || seen.has(i)) continue;
    const g = groupAt(b, i)!;
    g.stones.forEach((s) => seen.add(s));
    groups.push(g);
  }
  return groups;
}

export type MoveError = 'occupied' | 'suicide' | 'offboard';

export type MoveResult =
  | { ok: true; board: Cell[]; captured: number[] }
  | { ok: false; error: MoveError };

export function play(b: Board, i: number, color: Color): MoveResult {
  if (i < 0 || i >= POINTS) return { ok: false, error: 'offboard' };
  if (b[i]) return { ok: false, error: 'occupied' };
  const next = b.slice();
  next[i] = color;
  const captured: number[] = [];
  const enemy = other(color);
  for (const n of neighbors(i)) {
    if (next[n] !== enemy) continue;
    const g = groupAt(next, n)!;
    if (g.liberties.length === 0) {
      for (const s of g.stones) {
        next[s] = null;
        captured.push(s);
      }
    }
  }
  if (groupAt(next, i)!.liberties.length === 0) return { ok: false, error: 'suicide' };
  return { ok: true, board: next, captured };
}

export function isLegal(b: Board, i: number, color: Color): boolean {
  return play(b, i, color).ok;
}

export function sameGroup(b: Board, a: number, c: number): boolean {
  const g = groupAt(b, a);
  return !!g && g.stones.includes(c);
}

/** Empty region containing i and the colours bordering it. */
export function emptyRegion(b: Board, i: number): { points: number[]; borders: Set<Color> } {
  const points: number[] = [];
  const borders = new Set<Color>();
  if (b[i]) return { points, borders };
  const seen = new Set<number>([i]);
  const stack = [i];
  while (stack.length) {
    const p = stack.pop()!;
    points.push(p);
    for (const n of neighbors(p)) {
      const c = b[n];
      if (c) borders.add(c);
      else if (!seen.has(n)) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return { points, borders };
}

export interface StoneListError {
  point: string;
  msg: string;
}

/** Builds a board from coordinate lists and reports bad or conflicting coordinates. */
export function boardFromLists(black: string, white: string): { board: Cell[]; errors: StoneListError[] } {
  const board = emptyBoard();
  const errors: StoneListError[] = [];
  const add = (list: string, c: Color) => {
    for (const pt of list.split(/\s+/).filter(Boolean)) {
      const i = parsePoint(pt);
      if (i < 0) errors.push({ point: pt, msg: 'outside 9×9' });
      else if (board[i]) errors.push({ point: pt, msg: board[i] === c ? 'listed twice' : 'has both a black and a white stone' });
      else board[i] = c;
    }
  };
  add(black, 'B');
  add(white, 'W');
  return { board, errors };
}

export function boardToDiagram(b: Board): string[] {
  const rows: string[] = [];
  for (let y = 0; y < SIZE; y++) {
    let r = '';
    for (let x = 0; x < SIZE; x++) {
      const c = b[toIndex(x, y)];
      r += c === 'B' ? 'X' : c === 'W' ? 'O' : '.';
    }
    rows.push(r);
  }
  return rows;
}

export function boardKey(b: Board): string {
  let s = '';
  for (const c of b) s += c === 'B' ? 'X' : c === 'W' ? 'O' : '.';
  return s;
}
