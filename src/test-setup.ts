// Polyfills for running unit tests under jsdom (the default Vitest environment).
// Ionic components such as ion-menu and ion-split-pane query `window.matchMedia`,
// which jsdom does not implement.
if (!window.matchMedia) {
  window.matchMedia = (query: string): MediaQueryList =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener: () => undefined,
      removeListener: () => undefined,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
      dispatchEvent: () => false,
    }) as MediaQueryList;
}

// Capacitor Preferences' web implementation reads `window.localStorage`. Depending on
// the Node version, the test environment can expose it as undefined (Node's own Web
// Storage shadows jsdom's when no `--localstorage-file` is given), so fall back to an
// in-memory Storage whenever the real one is missing or unusable.
class MemoryStorage implements Storage {
  private readonly data = new Map<string, string>();

  get length(): number {
    return this.data.size;
  }

  clear(): void {
    this.data.clear();
  }

  getItem(key: string): string | null {
    return this.data.has(key) ? this.data.get(key)! : null;
  }

  key(index: number): string | null {
    return [...this.data.keys()][index] ?? null;
  }

  removeItem(key: string): void {
    this.data.delete(key);
  }

  setItem(key: string, value: string): void {
    this.data.set(key, String(value));
  }
}

function hasUsableLocalStorage(): boolean {
  try {
    const storage = window.localStorage;
    return typeof storage?.getItem === 'function' && typeof storage.setItem === 'function';
  } catch {
    return false;
  }
}

if (!hasUsableLocalStorage()) {
  const storage = new MemoryStorage();
  for (const target of [window, globalThis]) {
    Object.defineProperty(target, 'localStorage', { value: storage, configurable: true, writable: true });
  }
}

// jsdom doesn't implement element scrolling, which scrollable ion-segment uses.
if (!Element.prototype.scrollTo) {
  Element.prototype.scrollTo = () => undefined;
}
if (!Element.prototype.scrollIntoView) {
  Element.prototype.scrollIntoView = () => undefined;
}
