// Small tactical readers used by the problem validator (not needed at runtime).
// They are deliberately limited to what beginner problems need:
//  - capture reading for groups with at most `maxLibs` liberties (ladders, nets, simple chases);
//  - life & death search inside a fully enclosed area, with Benson's algorithm as the "alive" test.

import { type Board, type Color, allGroups, boardKey, groupAt, neighbors, other, play, POINTS } from './board';

export interface ReadOptions {
  depth?: number;
  /** Attacker gives up once the target has more liberties than this. */
  maxLibs?: number;
  /** Number of attacker plies that may also try points next to liberties (nets). */
  wide?: number;
}

const NODE_LIMIT = 400_000;

/** Attacker to move: can the stone at `t` be captured by force? */
export function canCapture(b: Board, t: number, opts: ReadOptions = {}): boolean {
  const def = b[t];
  if (!def) return true;
  const r = new Reader(def, t, opts.maxLibs ?? 2);
  return r.attack(b, opts.depth ?? 24, opts.wide ?? 2);
}

/** Defender (owner of `t`) to move: can the stone survive? */
export function canEscape(b: Board, t: number, opts: ReadOptions = {}): boolean {
  const def = b[t];
  if (!def) return false;
  const r = new Reader(def, t, opts.maxLibs ?? 2);
  return r.defend(b, opts.depth ?? 24, opts.wide ?? 2);
}

class Reader {
  private memo = new Map<string, boolean>();
  private nodes = 0;
  constructor(
    private def: Color,
    private t: number,
    private maxLibs: number,
  ) {}

  private tick() {
    if (++this.nodes > NODE_LIMIT) throw new Error('reading node limit exceeded');
  }

  attack(b: Board, depth: number, wide: number): boolean {
    this.tick();
    if (b[this.t] !== this.def) return true;
    const key = `A${depth}.${wide}.${boardKey(b)}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const res = this.attackInner(b, depth, wide);
    this.memo.set(key, res);
    return res;
  }

  private attackInner(b: Board, depth: number, wide: number): boolean {
    const att = other(this.def);
    const libs = groupAt(b, this.t)!.liberties;
    if (libs.length === 1) {
      if (play(b, libs[0]!, att).ok) return true;
    }
    if (depth <= 0 || libs.length > this.maxLibs) return false;
    const cand = new Set(libs);
    if (wide > 0) {
      for (const l of libs) for (const n of neighbors(l)) if (!b[n]) cand.add(n);
    }
    for (const m of cand) {
      const r = play(b, m, att);
      if (!r.ok) continue;
      if (r.board[this.t] !== this.def) return true;
      if (!this.defend(r.board, depth - 1, wide - 1)) return true;
    }
    return false;
  }

  defend(b: Board, depth: number, wide: number): boolean {
    this.tick();
    if (b[this.t] !== this.def) return false;
    const key = `D${depth}.${wide}.${boardKey(b)}`;
    const hit = this.memo.get(key);
    if (hit !== undefined) return hit;
    const res = this.defendInner(b, depth, wide);
    this.memo.set(key, res);
    return res;
  }

  private defendInner(b: Board, depth: number, wide: number): boolean {
    const g = groupAt(b, this.t)!;
    if (g.liberties.length > this.maxLibs) return true;
    // Out of depth: assume the defender gets away, so every claimed capture is proven.
    if (depth <= 0) return true;
    const cand = new Set(g.liberties);
    // Capturing an attacking chain that is in atari is the other classic defence.
    for (const s of g.stones) {
      for (const n of neighbors(s)) {
        if (b[n] !== other(this.def)) continue;
        const eg = groupAt(b, n)!;
        // Capture an attacker in atari, or counter-atari one with two liberties.
        if (eg.liberties.length <= 2) eg.liberties.forEach((l) => cand.add(l));
      }
    }
    for (const m of cand) {
      const r = play(b, m, this.def);
      if (!r.ok) continue;
      if (!this.attack(r.board, depth - 1, wide)) return true;
    }
    // Tenuki: fine if the attacker cannot capture even with an extra move.
    if (g.liberties.length >= 2 && !this.attack(b, depth - 1, wide)) return true;
    return false;
  }
}

// ---------------------------------------------------------------- Benson

/** Stones of `color` that are unconditionally alive (Benson's algorithm). */
export function bensonAlive(b: Board, color: Color): Set<number> {
  const chains = allGroups(b).filter((g) => g.color === color);
  const chainOf = new Map<number, number>();
  chains.forEach((g, ci) => g.stones.forEach((s) => chainOf.set(s, ci)));
  const libSets = chains.map((g) => new Set(g.liberties));

  // Regions: maximal connected sets of points not occupied by `color`.
  const regionOf = new Array<number>(POINTS).fill(-1);
  const regions: { points: number[]; borderChains: Set<number> }[] = [];
  for (let i = 0; i < POINTS; i++) {
    if (b[i] === color || regionOf[i] !== -1) continue;
    const rid = regions.length;
    const points: number[] = [];
    const borderChains = new Set<number>();
    const stack = [i];
    regionOf[i] = rid;
    while (stack.length) {
      const p = stack.pop()!;
      points.push(p);
      for (const n of neighbors(p)) {
        if (b[n] === color) borderChains.add(chainOf.get(n)!);
        else if (regionOf[n] === -1) {
          regionOf[n] = rid;
          stack.push(n);
        }
      }
    }
    regions.push({ points, borderChains });
  }

  const liveChains = new Set(chains.map((_, i) => i));
  const liveRegions = new Set(regions.map((_, i) => i));
  const isVital = (ri: number, ci: number) =>
    regions[ri]!.points.every((p) => b[p] !== null || libSets[ci]!.has(p));

  for (;;) {
    let changed = false;
    for (const ci of [...liveChains]) {
      let vital = 0;
      for (const ri of liveRegions) {
        if (regions[ri]!.borderChains.has(ci) && isVital(ri, ci)) vital++;
      }
      if (vital < 2) {
        liveChains.delete(ci);
        changed = true;
      }
    }
    for (const ri of [...liveRegions]) {
      for (const ci of regions[ri]!.borderChains) {
        if (!liveChains.has(ci)) {
          liveRegions.delete(ri);
          changed = true;
          break;
        }
      }
    }
    if (!changed) break;
  }

  const alive = new Set<number>();
  for (const ci of liveChains) chains[ci]!.stones.forEach((s) => alive.add(s));
  return alive;
}

// ---------------------------------------------------------- life & death

/** Empty points reachable from the target group through empty points and its own stones. */
export function enclosedArea(b: Board, t: number): number[] {
  const color = b[t];
  if (!color) return [];
  const seen = new Set<number>([t]);
  const stack = [t];
  const empties: number[] = [];
  while (stack.length) {
    const p = stack.pop()!;
    if (!b[p]) empties.push(p);
    for (const n of neighbors(p)) {
      if (seen.has(n)) continue;
      if (b[n] === null || b[n] === color) {
        seen.add(n);
        stack.push(n);
      }
    }
  }
  return empties;
}

export const MAX_LD_AREA = 14;

/**
 * Life & death inside an enclosure. `toMove` plays first.
 * Returns true when the target group can be made/kept unconditionally alive.
 * The surrounding wall is assumed to be safe; seki is treated as death.
 */
export function canLive(b: Board, t: number, toMove: Color): boolean {
  const def = b[t];
  if (!def) return false;
  const area = enclosedArea(b, t);
  if (area.length > MAX_LD_AREA) throw new Error(`target at ${t} is not enclosed (area ${area.length})`);
  const memo = new Map<string, boolean>();
  let nodes = 0;
  const depthLimit = area.length * 3 + 6;

  const search = (bd: Board, mover: Color, passes: number, depth: number): boolean => {
    if (++nodes > NODE_LIMIT) throw new Error('life search node limit exceeded');
    if (bd[t] !== def) return false;
    if (bensonAlive(bd, def).has(t)) return true;
    if (passes >= 2 || depth <= 0) return false;
    const key = `${mover}${passes}.${boardKey(bd)}`;
    const hit = memo.get(key);
    if (hit !== undefined) return hit;
    const moves = enclosedArea(bd, t);
    let res: boolean;
    if (mover === def) {
      res = false;
      for (const m of moves) {
        const r = play(bd, m, def);
        if (r.ok && search(r.board, other(def), 0, depth - 1)) {
          res = true;
          break;
        }
      }
      if (!res) res = search(bd, other(def), passes + 1, depth - 1);
    } else {
      res = true;
      for (const m of moves) {
        const r = play(bd, m, mover);
        if (r.ok && !search(r.board, def, 0, depth - 1)) {
          res = false;
          break;
        }
      }
      if (res) res = search(bd, def, passes + 1, depth - 1);
    }
    memo.set(key, res);
    return res;
  };

  return search(b, toMove, 0, depthLimit);
}
