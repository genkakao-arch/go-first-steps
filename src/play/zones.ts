// The board split into nine areas (corners, sides, centre). Hints point to an area,
// not to a single point, so the learner still has to find the move.

import { SIZE, toXY } from '../go/board';
import { PASS, type SearchResult } from '../katago/search';

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

const band = (v: number) => (v <= 2 ? 0 : v <= 5 ? 1 : 2);

export function regionOf(point: number): string {
  const [x, y] = toXY(point);
  return `${COLS[band(x)]}-${ROWS[band(y)]}`;
}

export function regionName(key: string, grammaticalCase: 'nom' | 'acc' = 'nom'): string {
  return REGION_NAMES[key]![grammaticalCase];
}

export function regionPoints(key: string): number[] {
  const out: number[] = [];
  for (let i = 0; i < SIZE * SIZE; i++) if (regionOf(i) === key) out.push(i);
  return out;
}

export interface Zone {
  regions: string[];
  points: number[];
  /** "левый нижний угол" or "левый нижний угол и нижняя сторона". */
  name: string;
}

/** Fraction of the best move's visits a move needs to count as a good alternative. */
const GOOD_SHARE = 0.15;
/** …and how close in points it must be. */
const GOOD_LOSS = 1.5;

/** Areas holding KataGo's good moves (at most two), or null when passing is best. */
export function goodZone(res: SearchResult | null): Zone | null {
  const best = res?.moves[0];
  if (!res || !best || best.move === PASS) return null;
  const weight = new Map<string, number>();
  for (const m of res.moves) {
    if (m.move === PASS || m.visits < best.visits * GOOD_SHARE || best.lead - m.lead > GOOD_LOSS) continue;
    const r = regionOf(m.move);
    weight.set(r, (weight.get(r) ?? 0) + m.visits);
  }
  const regions = [...weight.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 2)
    .map(([r]) => r);
  // The best move's area always comes first.
  const first = regionOf(best.move);
  const ordered = [first, ...regions.filter((r) => r !== first)].slice(0, 2);
  return {
    regions: ordered,
    points: ordered.flatMap(regionPoints),
    name: ordered.map((r) => regionName(r)).join(' и '),
  };
}
