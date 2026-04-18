import * as SecureStore from "expo-secure-store";

/**
 * Cognito-compatible storage adapter backed by expo-secure-store.
 *
 * amazon-cognito-identity-js expects a synchronous Storage API (like window.localStorage).
 * SecureStore is async, so we hydrate a synchronous in-memory cache on startup and
 * write-through to the secure store in the background.
 */
export class CognitoSecureStorage {
  private cache: Record<string, string> = {};
  private ready = false;
  private readyPromise: Promise<void> | null = null;

  async hydrate(): Promise<void> {
    if (this.readyPromise) return this.readyPromise;
    this.readyPromise = (async () => {
      const manifest = await SecureStore.getItemAsync("thinkwork.cognito.keys");
      if (manifest) {
        try {
          const keys: string[] = JSON.parse(manifest);
          for (const key of keys) {
            const value = await SecureStore.getItemAsync(this.sanitize(key));
            if (value !== null) this.cache[key] = value;
          }
        } catch {
          // ignore malformed manifest; treat as empty
        }
      }
      this.ready = true;
    })();
    return this.readyPromise;
  }

  isReady(): boolean {
    return this.ready;
  }

  getItem(key: string): string | null {
    return this.cache[key] ?? null;
  }

  setItem(key: string, value: string): void {
    this.cache[key] = value;
    void SecureStore.setItemAsync(this.sanitize(key), value);
    void this.persistManifest();
  }

  removeItem(key: string): void {
    delete this.cache[key];
    void SecureStore.deleteItemAsync(this.sanitize(key));
    void this.persistManifest();
  }

  clear(): void {
    const keys = Object.keys(this.cache);
    this.cache = {};
    for (const key of keys) void SecureStore.deleteItemAsync(this.sanitize(key));
    void SecureStore.deleteItemAsync("thinkwork.cognito.keys");
  }

  private sanitize(key: string): string {
    // SecureStore keys must be alphanumeric + `.-_`
    return key.replace(/[^A-Za-z0-9._-]/g, "_");
  }

  private async persistManifest(): Promise<void> {
    try {
      await SecureStore.setItemAsync(
        "thinkwork.cognito.keys",
        JSON.stringify(Object.keys(this.cache)),
      );
    } catch {
      // best-effort
    }
  }
}

export const cognitoStorage = new CognitoSecureStorage();
