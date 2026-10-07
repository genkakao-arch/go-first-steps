// One KataGo worker for the whole app, so the network is loaded only once per session.
// The learner can choose between the small fast network and KataGo's strong 9×9 network.
import { KataGoClient } from './client';

export type ModelId = 'fast' | 'strong';

export interface ModelInfo {
  label: string;
  /** Download size in MB, shown before switching. */
  mb: number;
  /** Relative to the site root; absolute URLs are built below (the worker lives in assets/). */
  path: string;
  /** Playouts per move in a game: the strong network needs far fewer for better judgement. */
  visits: number;
}

export const MODELS: Record<ModelId, ModelInfo> = {
  fast: { label: 'Быстрая сеть', mb: 3.8, path: 'models/katago-small.bin.gz', visits: 120 },
  strong: { label: 'Сильная сеть 9×9', mb: 98, path: 'models/kata9x9/manifest.json', visits: 40 },
};

const KEY = 'go-trainer-model';

export function modelChoice(): ModelId {
  try {
    return localStorage.getItem(KEY) === 'strong' ? 'strong' : 'fast';
  } catch {
    return 'fast';
  }
}

type Progress = { loaded: number; total: number };
type Listener = (p: Progress) => void;

let client: KataGoClient | null = null;
let ready: ReturnType<KataGoClient['init']> | null = null;
let loadedModel: ModelId | null = null;
let progress: Progress | null = null;
const listeners = new Set<Listener>();

export function onModelProgress(fn: Listener): () => void {
  listeners.add(fn);
  if (progress) fn(progress);
  return () => listeners.delete(fn);
}

export function sharedKataGo(): { client: KataGoClient; ready: ReturnType<KataGoClient['init']>; model: ModelId } {
  const want = modelChoice();
  if (!client || !ready || loadedModel !== want) {
    client?.dispose();
    client = new KataGoClient();
    loadedModel = want;
    progress = null;
    const url = new URL(MODELS[want].path, document.baseURI).href;
    ready = client.init(url, 'auto', (loaded, total) => {
      progress = { loaded, total };
      listeners.forEach((l) => l(progress!));
    });
    const mine = client;
    // Allow a retry after a failed load.
    ready.catch(() => {
      if (client !== mine) return;
      client.dispose();
      client = null;
      ready = null;
      loadedModel = null;
    });
  }
  return { client, ready, model: loadedModel! };
}

/** Switches the network; the next sharedKataGo() call loads it. */
export function chooseModel(id: ModelId): void {
  try {
    localStorage.setItem(KEY, id);
  } catch {
    /* ignore */
  }
}
