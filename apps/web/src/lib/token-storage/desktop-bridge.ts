import type {
  ThinkworkBridge,
  TokenStorageSnapshot,
} from "@thinkwork/desktop-ipc";
import type { TokenStorage } from "./index";

declare global {
  interface Window {
    thinkworkBridge?: ThinkworkBridge;
  }
}

export class DesktopBridgeTokenStorage implements TokenStorage {
  private readonly cache = new Map<string, string>();
  private readonly listeners = new Set<() => void>();
  private readonly unsubscribeTokensChanged: () => void;
  private version = 0;

  constructor(private readonly bridge: ThinkworkBridge = requiredBridge()) {
    this.unsubscribeTokensChanged = this.bridge.onTokensChanged((snapshot) => {
      if (snapshot.version > this.version + 1) {
        void this.hydrate();
        return;
      }

      this.applySnapshot(snapshot);
    });
  }

  async hydrate(): Promise<void> {
    const snapshot = await this.bridge.getSessionTokens();
    this.applySnapshot(snapshot ?? { items: {}, version: 0 });
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    const current = this.cache.get(key);
    this.cache.set(key, value);
    if (current === value) return;

    void this.bridge.setTokenStorageItem({ key, value }).catch((error) => {
      console.error(
        "[desktop:token-storage] failed to persist token item",
        error,
      );
    });
  }

  removeItem(key: string): void {
    const hadKey = this.cache.delete(key);
    if (!hadKey) return;

    void this.bridge.removeTokenStorageItem({ key }).catch((error) => {
      console.error(
        "[desktop:token-storage] failed to remove token item",
        error,
      );
    });
  }

  clear(): void {
    const hadItems = this.cache.size > 0 || this.version !== 0;
    this.cache.clear();
    this.version = 0;
    if (!hadItems) return;

    void this.bridge.clearTokenStorage().catch((error) => {
      console.error(
        "[desktop:token-storage] failed to clear token storage",
        error,
      );
    });
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  dispose(): void {
    this.unsubscribeTokensChanged();
    this.listeners.clear();
  }

  private applySnapshot(snapshot: TokenStorageSnapshot): void {
    if (this.matchesSnapshot(snapshot)) return;

    this.cache.clear();
    for (const [key, value] of Object.entries(snapshot.items)) {
      this.cache.set(key, value);
    }
    this.version = snapshot.version;
    this.emitChange();
  }

  private matchesSnapshot(snapshot: TokenStorageSnapshot): boolean {
    if (snapshot.version !== this.version) return false;
    const entries = Object.entries(snapshot.items);
    if (entries.length !== this.cache.size) return false;

    return entries.every(([key, value]) => this.cache.get(key) === value);
  }

  private emitChange(): void {
    for (const listener of this.listeners) listener();
  }
}

function requiredBridge(): ThinkworkBridge {
  if (!window.thinkworkBridge) {
    throw new Error("Desktop bridge is unavailable");
  }

  return window.thinkworkBridge;
}
