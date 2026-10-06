/// <reference lib="webworker" />
import { evaluate, initBackend, loadModel } from './net';
import type { WorkerRequest, WorkerResponse } from './protocol';
import { newGame, search } from './search';

const reply = (msg: WorkerResponse) => (self as unknown as DedicatedWorkerGlobalScope).postMessage(msg);

self.onmessage = async (e: MessageEvent<WorkerRequest>) => {
  const req = e.data;
  try {
    if (req.type === 'init') {
      const t0 = performance.now();
      const { backend, notes } = await initBackend(req.prefer);
      const model = await loadModel(req.modelUrl);
      reply({ id: req.id, type: 'init', backend, notes, modelName: model.name, modelBytes: model.bytes, ms: performance.now() - t0 });
    } else if (req.type === 'bench') {
      const g = newGame();
      const times: number[] = [];
      for (let i = 0; i < req.runs; i++) {
        const t = performance.now();
        await evaluate(g.board, g.toPlay, g.history);
        times.push(performance.now() - t);
      }
      reply({ id: req.id, type: 'bench', runs: req.runs, avgMs: times.reduce((a, b) => a + b, 0) / times.length, minMs: Math.min(...times) });
    } else {
      const t = performance.now();
      const result = await search(req.state, req.visits, (s) => evaluate(s.board, s.toPlay, s.history, s.previous));
      reply({ id: req.id, type: 'search', result, ms: performance.now() - t });
    }
  } catch (err) {
    reply({ id: req.id, type: 'error', message: err instanceof Error ? err.message : String(err) });
  }
};

