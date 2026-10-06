// Installed-app helpers (PWA). Everything is best-effort and safe to call anywhere.

export function isStandalone(): boolean {
  const nav = navigator as Navigator & { standalone?: boolean };
  return window.matchMedia?.('(display-mode: standalone)').matches === true || nav.standalone === true;
}

export function isIOS(): boolean {
  return /iPhone|iPad|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
}

/** Asks the browser not to evict our storage (progress, later the KataGo network). */
export function requestPersistentStorage(): void {
  void navigator.storage?.persist?.().catch(() => false);
}

const HINT_KEY = 'go-trainer-install-hint-hidden';

export function installHintHidden(): boolean {
  try {
    return localStorage.getItem(HINT_KEY) === '1';
  } catch {
    return false;
  }
}

export function hideInstallHint(): void {
  try {
    localStorage.setItem(HINT_KEY, '1');
  } catch {
    /* ignore */
  }
}
