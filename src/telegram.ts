// Thin, typed wrapper around the Telegram Mini Apps JS API (telegram-web-app.js).
// Everything is optional: outside Telegram the app runs as a normal web page.

interface TgButton {
  show(): void;
  hide(): void;
  onClick(cb: () => void): void;
  offClick(cb: () => void): void;
}

interface TgCloudStorage {
  setItem(key: string, value: string, cb?: (err: string | null, ok?: boolean) => void): void;
  getItem(key: string, cb: (err: string | null, value?: string) => void): void;
}

interface TgHaptic {
  notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  impactOccurred(style: 'light' | 'medium' | 'heavy' | 'rigid' | 'soft'): void;
}

export interface TgWebApp {
  initData: string;
  platform: string;
  version: string;
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string | undefined>;
  isVersionAtLeast(v: string): boolean;
  ready(): void;
  expand(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  setBackgroundColor?(color: string): void;
  onEvent(event: string, cb: () => void): void;
  BackButton: TgButton;
  HapticFeedback?: TgHaptic;
  CloudStorage?: TgCloudStorage;
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

function webApp(): TgWebApp | null {
  return window.Telegram?.WebApp ?? null;
}

/** True only when the page is actually running inside a Telegram client. */
export function inTelegram(): boolean {
  const wa = webApp();
  return !!wa && (wa.initData !== '' || (wa.platform !== '' && wa.platform !== 'unknown'));
}

function atLeast(v: string): boolean {
  const wa = webApp();
  return !!wa && inTelegram() && wa.isVersionAtLeast(v);
}

export function initTelegram(onThemeChange: () => void): void {
  const wa = webApp();
  if (!wa || !inTelegram()) return;
  wa.ready();
  wa.expand();
  // The board uses taps; vertical swipes must not close the app mid-move.
  if (atLeast('7.7')) wa.disableVerticalSwipes?.();
  const syncColors = () => {
    if (atLeast('6.1')) {
      wa.setHeaderColor?.('bg_color');
      wa.setBackgroundColor?.('bg_color');
    }
    document.documentElement.dataset.tgScheme = wa.colorScheme;
    onThemeChange();
  };
  syncColors();
  wa.onEvent('themeChanged', syncColors);
}

export function setBackButton(handler: (() => void) | null): () => void {
  const wa = webApp();
  if (!wa || !atLeast('6.1')) return () => {};
  if (!handler) {
    wa.BackButton.hide();
    return () => {};
  }
  wa.BackButton.onClick(handler);
  wa.BackButton.show();
  return () => {
    wa.BackButton.offClick(handler);
    wa.BackButton.hide();
  };
}

export function haptic(kind: 'success' | 'error' | 'warning' | 'tap'): void {
  const wa = webApp();
  if (!wa?.HapticFeedback || !atLeast('6.1')) return;
  if (kind === 'tap') wa.HapticFeedback.impactOccurred('light');
  else wa.HapticFeedback.notificationOccurred(kind);
}

export function cloudStorage(): TgCloudStorage | null {
  const wa = webApp();
  return wa?.CloudStorage && atLeast('6.9') ? wa.CloudStorage : null;
}
