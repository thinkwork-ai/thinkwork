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
const CLIENT_ID = process.env.EXPO_PUBLIC_COGNITO_CLIENT_ID || "";

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

  const t0 = Date.now();
  console.log("[auth-boot] hydrate start, clientIdLen=", CLIENT_ID.length);

  try {
    // SecureStore doesn't support listing keys. We derive the full set of
    // known Cognito keys from LastAuthUser (plus a legacy manifest fallback
    // for older sessions). Relying on LastAuthUser avoids a failure mode
    // where a reload — e.g. Updates.reloadAsync() after an OTA install —
    // killed the debounced manifest write before it could flush.
    const lastUserKey = `${PREFIX}.${CLIENT_ID}.LastAuthUser`;
    const username = await SecureStore.getItemAsync(lastUserKey);
    console.log("[auth-boot] hydrate LastAuthUser:", username ? `len=${username.length}` : "null");
    const keysToLoad = new Set<string>();

    if (username) {
      keysToLoad.add(lastUserKey);
      const userPrefix = `${PREFIX}.${CLIENT_ID}.${username}`;
      keysToLoad.add(`${userPrefix}.idToken`);
      keysToLoad.add(`${userPrefix}.accessToken`);
      keysToLoad.add(`${userPrefix}.refreshToken`);
      keysToLoad.add(`${userPrefix}.clockDrift`);
      keysToLoad.add(`${userPrefix}.userData`);
    }

    // Legacy manifest support (pre-fix sessions). Harmless once all users
    // have re-signed in under the new hydration path; delete later.
    const manifestRaw = await SecureStore.getItemAsync(`${PREFIX}.__manifest__`);
    if (manifestRaw) {
      try {
        const keys: string[] = JSON.parse(manifestRaw);
        keys.forEach((k) => keysToLoad.add(k));
      } catch {}
    }

    let foundCount = 0;
    await Promise.all(
      [...keysToLoad].map(async (key) => {
        const value = await SecureStore.getItemAsync(key);
        if (value !== null) {
          memoryCache.set(key, value);
          foundCount += 1;
        }
      }),
    );
    console.log(
      `[auth-boot] hydrate done in ${Date.now() - t0}ms, queried=${keysToLoad.size}, found=${foundCount}, cacheSize=${memoryCache.size}`,
    );
  } catch (e) {
    console.warn("[auth-boot] hydrate error:", e);
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
