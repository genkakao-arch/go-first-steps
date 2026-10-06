// Subset of web-katrain's src/types.ts needed by the vendored engine files.
export type Player = 'black' | 'white';
export type Intersection = Player | null;
export type BoardState = Intersection[][];
export type GameRules =
  | 'japanese'
  | 'chinese'
  | 'korean'
  | 'aga'
  | 'new-zealand'
  | 'tromp-taylor'
  | 'stone-scoring';

export interface Move {
  x: number;
  y: number;
  player: Player;
}
