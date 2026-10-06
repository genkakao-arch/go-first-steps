// One KataGo worker for the whole app, so the network is loaded only once per session.
import { KataGoClient } from './client';

// Absolute URL: the worker lives in assets/, so a relative path would resolve there.
export const MODEL_URL = new URL('models/katago-small.bin.gz', document.baseURI).href;

let client: KataGoClient | null = null;
let ready: ReturnType<KataGoClient['init']> | null = null;

export function sharedKataGo(): { client: KataGoClient; ready: ReturnType<KataGoClient['init']> } {
  if (!client || !ready) {
    client = new KataGoClient();
    ready = client.init(MODEL_URL);
    // Allow a retry after a failed load.
    ready.catch(() => {
      client?.dispose();
      client = null;
      ready = null;
    });
  }
  return { client, ready };
}
