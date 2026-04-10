/**
 * SecureStore-backed storage adapter for amazon-cognito-identity-js.
 *
 * On React Native, the Cognito SDK defaults to in-memory storage, which means
 * tokens are lost on every app reload. This adapter uses expo-secure-store on
 * native and localStorage on web so sessions survive restarts.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";

const PREFIX = "CognitoIdentityServiceProvider";

// In-memory cache so synchronous reads work (Cognito SDK calls getItem synchronously)
const memoryCache = new Map<string, string>();

// On startup, we need to hydrate the memory cache from SecureStore.
// This must complete before CognitoUserPool tries to read tokens.
let hydrated = false;
const hydratePromise = hydrate();

async function hydrate() {
  if (Platform.OS === "web") {
    hydrated = true;
    return;
  }

  try {
    // SecureStore doesn't support listing keys, so we read the known key
    // patterns that Cognito uses. The SDK stores:
    //   <prefix>.<clientId>.LastAuthUser
    //   <prefix>.<clientId>.<username>.idToken
    //   <prefix>.<clientId>.<username>.accessToken
    //   <prefix>.<clientId>.<username>.refreshToken
    //   <prefix>.<clientId>.<username>.clockDrift
    //   <prefix>.<clientId>.<username>.userData
    //
    // We store the set of known keys under a manifest key.
    const manifestRaw = await SecureStore.getItemAsync(`${PREFIX}.__manifest__`);
    if (manifestRaw) {
      const keys: string[] = JSON.parse(manifestRaw);
      await Promise.all(
        keys.map(async (key) => {
          const value = await SecureStore.getItemAsync(key);
          if (value !== null) {
            memoryCache.set(key, value);
          }
        }),
      );
    }
  } catch (e) {
    console.warn("[CognitoStorage] hydrate error:", e);
  }
  hydrated = true;
}

/** Wait for the cache to be hydrated from SecureStore. */
export function waitForStorageReady(): Promise<void> {
  return hydratePromise;
}

export function isStorageReady(): boolean {
  return hydrated;
}

// Maintain a set of all keys we've stored so we can hydrate next time.
// Debounced: Cognito writes ~6 keys in rapid succession during sign-in,
// so we batch the manifest write to avoid 6 sequential SecureStore calls.
let manifestTimer: ReturnType<typeof setTimeout> | null = null;

function updateManifest() {
  if (Platform.OS === "web") return;
  if (manifestTimer) clearTimeout(manifestTimer);
  manifestTimer = setTimeout(() => {
    manifestTimer = null;
    const keys = [...memoryCache.keys()];
    SecureStore.setItemAsync(`${PREFIX}.__manifest__`, JSON.stringify(keys)).catch((e) =>
      console.warn("[CognitoStorage] manifest write error:", e),
    );
  }, 100);
}

/**
 * ICognitoStorage-compatible adapter.
 *
 * On web, delegates to localStorage. On native, reads from an in-memory cache
 * that is backed by SecureStore (writes are async but the cache is synchronous).
 */
export const CognitoSecureStorage = {
  setItem(key: string, value: string): string {
    if (Platform.OS === "web") {
      localStorage.setItem(key, value);
      return value;
    }
    memoryCache.set(key, value);
    SecureStore.setItemAsync(key, value).catch((e) =>
      console.warn("[CognitoStorage] setItem error:", e),
    );
    updateManifest();
    return value;
  },

  getItem(key: string): string | null {
    if (Platform.OS === "web") {
      return localStorage.getItem(key);
    }
    return memoryCache.get(key) ?? null;
  },

  removeItem(key: string): boolean {
    if (Platform.OS === "web") {
      localStorage.removeItem(key);
      return true;
    }
    memoryCache.delete(key);
    SecureStore.deleteItemAsync(key).catch((e) =>
      console.warn("[CognitoStorage] removeItem error:", e),
    );
    updateManifest();
    return true;
  },

  clear(): object {
    if (Platform.OS === "web") {
      // Only clear Cognito keys, not all of localStorage
      const toRemove: string[] = [];
      for (let i = 0; i < localStorage.length; i++) {
        const k = localStorage.key(i);
        if (k?.startsWith(PREFIX)) toRemove.push(k);
      }
      toRemove.forEach((k) => localStorage.removeItem(k));
      return {};
    }
    const keys = [...memoryCache.keys()];
    memoryCache.clear();
    keys.forEach((k) =>
      SecureStore.deleteItemAsync(k).catch((e) =>
        console.warn("[CognitoStorage] clear error:", e),
      ),
    );
    SecureStore.deleteItemAsync(`${PREFIX}.__manifest__`).catch(() => {});
    return {};
  },
};
