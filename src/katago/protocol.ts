import type { Backend } from './net';
import type { GameState, SearchResult } from './search';

export type WorkerRequest =
  | { id: number; type: 'init'; modelUrl: string; prefer: Backend | 'auto' }
  | { id: number; type: 'bench'; runs: number }
  | { id: number; type: 'search'; state: GameState; visits: number; ownership?: boolean }
  | { id: number; type: 'line'; state: GameState; moves: number[] };

export type WorkerResponse =
  | { id: number; type: 'init'; backend: Backend; notes: string[]; modelName: string; modelBytes: number; ms: number }
  | { id: number; type: 'bench'; avgMs: number; minMs: number; runs: number }
  | { id: number; type: 'search'; result: SearchResult; ms: number }
  | { id: number; type: 'line'; ownership: number[]; leadBlack: number; played: number }
  | { id: number; type: 'error'; message: string };
