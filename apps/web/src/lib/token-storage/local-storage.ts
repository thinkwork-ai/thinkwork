import type { TokenStorage } from "./index";

export class LocalStorageTokenStorage implements TokenStorage {
  constructor(
    private readonly storage: Storage = window.localStorage,
    private readonly eventTarget: Window = window,
  ) {}

  getItem(key: string): string | null {
    return this.storage.getItem(key);
  }

  setItem(key: string, value: string): void {
    this.storage.setItem(key, value);
  }

  removeItem(key: string): void {
    this.storage.removeItem(key);
  }

  clear(): void {
    this.storage.clear();
  }

  subscribe(listener: () => void): () => void {
    const onStorage = () => listener();

    this.eventTarget.addEventListener("storage", onStorage);
    return () => this.eventTarget.removeEventListener("storage", onStorage);
  }
}
