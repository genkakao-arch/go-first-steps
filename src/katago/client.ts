// Main-thread wrapper around the KataGo Web Worker.
import type { Backend } from './net';
import type { WorkerRequest, WorkerResponse } from './protocol';
import type { GameState } from './search';

type Pending = { resolve: (r: WorkerResponse) => void; reject: (e: Error) => void; onProgress?: (loaded: number, total: number) => void };

type Req = WorkerRequest extends infer R ? (R extends { id: number } ? Omit<R, 'id'> : never) : never;

export class KataGoClient {
  private worker = new Worker(new URL('./worker.ts', import.meta.url), { type: 'module' });
  private next = 1;
  private pending = new Map<number, Pending>();

  constructor() {
    this.worker.onmessage = (e: MessageEvent<WorkerResponse>) => {
      const p = this.pending.get(e.data.id);
      if (!p) return;
      if (e.data.type === 'progress') {
        p.onProgress?.(e.data.loaded, e.data.total);
        return;
      }
      this.pending.delete(e.data.id);
      if (e.data.type === 'error') p.reject(new Error(e.data.message));
      else p.resolve(e.data);
    };
    this.worker.onerror = (e) => {
      const err = new Error(e.message || 'Ошибка в KataGo worker');
      this.pending.forEach((p) => p.reject(err));
      this.pending.clear();
    };
  }

  private send<T extends WorkerResponse['type']>(
    req: Req,
    onProgress?: (loaded: number, total: number) => void,
  ): Promise<Extract<WorkerResponse, { type: T }>> {
    const id = this.next++;
    return new Promise((resolve, reject) => {
      this.pending.set(id, { resolve: resolve as (r: WorkerResponse) => void, reject, onProgress });
      this.worker.postMessage({ ...req, id } as WorkerRequest);
    });
  }

  init(modelUrl: string, prefer: Backend | 'auto' = 'auto', onProgress?: (loaded: number, total: number) => void) {
    return this.send<'init'>({ type: 'init', modelUrl, prefer }, onProgress);
  }

  bench(runs: number) {
    return this.send<'bench'>({ type: 'bench', runs });
  }

  search(state: GameState, visits: number, ownership = false) {
    return this.send<'search'>({ type: 'search', state, visits, ownership });
  }

  /** KataGo's ownership map after playing `moves` from `state`. */
  line(state: GameState, moves: number[]) {
    return this.send<'line'>({ type: 'line', state, moves });
  }

  dispose() {
    this.worker.terminate();
  }
}
