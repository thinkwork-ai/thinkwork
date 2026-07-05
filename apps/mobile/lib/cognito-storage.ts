/**
 * SecureStore-backed storage adapter for amazon-cognito-identity-js.
 *
 * On React Native, the Cognito SDK defaults to in-memory storage, which means
 * tokens are lost on every app reload. This adapter uses expo-secure-store on
 * native and localStorage on web so sessions survive restarts.
 */

import { Platform } from "react-native";
import * as SecureStore from "expo-secure-store";
import { getPlatformConfig } from "./platform-config";

const PREFIX = "CognitoIdentityServiceProvider";
const KEYCHAIN_ACCESSIBLE_OPTIONS = {
  keychainAccessible: SecureStore.AFTER_FIRST_UNLOCK,
};

/**
 * SecureStore only accepts keys matching [A-Za-z0-9._-]. Cognito token keys
 * embed the username, which for email/password users contains "@" — writes
 * for those keys were rejected, so email sign-ins never persisted a session.
 * Map unsafe keys to a deterministic safe alias at the SecureStore boundary;
 * the memory cache, manifest contents, and the Cognito SDK keep raw keys.
 * Safe keys pass through untouched, so existing stored sessions keep their
 * names (unsafe keys never persisted, so there is nothing to migrate).
 */
const SECURE_STORE_SAFE_KEY = /^[A-Za-z0-9._-]+$/;

export function secureStoreKeyFor(key: string): string {
  if (SECURE_STORE_SAFE_KEY.test(key)) return key;
  return key.replace(
    /[^A-Za-z0-9._-]/g,
    (ch) => `-x${ch.codePointAt(0)!.toString(16)}-`,
  );
}

// In-memory cache so synchronous reads work (Cognito SDK calls getItem synchronously)
const memoryCache = new Map<string, string>();

// On startup, we need to hydrate the memory cache from SecureStore.
// This must complete before CognitoUserPool tries to read tokens.
let hydrated = false;
let hydratePromise: Promise<void> | null = null;

async function hydrate() {
  if (Platform.OS === "web") {
    hydrated = true;
    return;
  }

  const t0 = Date.now();
  const clientId = getPlatformConfig().cognitoClientId;
  console.log("[auth-boot] hydrate start, clientIdLen=", clientId.length);
  if (!clientId) {
    hydrated = true;
    return;
  }

  try {
    // SecureStore doesn't support listing keys. We derive the full set of
    // known Cognito keys from LastAuthUser (plus a legacy manifest fallback
    // for older sessions). Relying on LastAuthUser avoids a failure mode
    // where a reload — e.g. Updates.reloadAsync() after an OTA install —
    // killed the debounced manifest write before it could flush.
    const lastUserKey = `${PREFIX}.${clientId}.LastAuthUser`;
    const migrationKey = `${PREFIX}.${clientId}.__after_first_unlock_migrated__`;
    const migrationDone = await SecureStore.getItemAsync(migrationKey);
    const username = await SecureStore.getItemAsync(lastUserKey);
    console.log(
      "[auth-boot] hydrate LastAuthUser:",
      username ? `len=${username.length}` : "null",
    );
    const keysToLoad = new Set<string>();

    if (username) {
      keysToLoad.add(lastUserKey);
      const userPrefix = `${PREFIX}.${clientId}.${username}`;
      keysToLoad.add(`${userPrefix}.idToken`);
      keysToLoad.add(`${userPrefix}.accessToken`);
      keysToLoad.add(`${userPrefix}.refreshToken`);
      keysToLoad.add(`${userPrefix}.clockDrift`);
      keysToLoad.add(`${userPrefix}.userData`);
    }

    const scopedManifestRaw = await SecureStore.getItemAsync(
      manifestKeyForClientId(clientId),
    );
    addManifestKeys(keysToLoad, scopedManifestRaw);

    // Legacy manifest support (pre-environment-scoped sessions). Harmless
    // once all users have re-signed in under the scoped manifest path; delete
    // later.
    addManifestKeys(
      keysToLoad,
      await SecureStore.getItemAsync(`${PREFIX}.__manifest__`),
    );

    let foundCount = 0;
    const loadedEntries: Array<[string, string]> = [];
    await Promise.all(
      [...keysToLoad].map(async (key) => {
        const value = await SecureStore.getItemAsync(secureStoreKeyFor(key));
        if (value !== null) {
          memoryCache.set(key, value);
          loadedEntries.push([key, value]);
          foundCount += 1;
        }
      }),
    );
    if (!migrationDone && loadedEntries.length > 0) {
      await Promise.all(
        loadedEntries.map(([key, value]) =>
          SecureStore.setItemAsync(
            secureStoreKeyFor(key),
            value,
            KEYCHAIN_ACCESSIBLE_OPTIONS,
          ),
        ),
      );
      await SecureStore.setItemAsync(
        migrationKey,
        "true",
        KEYCHAIN_ACCESSIBLE_OPTIONS,
      );
    }
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
  hydratePromise ??= hydrate();
  return hydratePromise;
}

export function isStorageReady(): boolean {
  return hydrated;
}

export function resetStorageHydrationForDeploymentChange() {
  hydrated = false;
  hydratePromise = null;
}

// Maintain a set of all keys we've stored so we can hydrate next time.
// Debounced: Cognito writes ~6 keys in rapid succession during sign-in,
// so we batch the manifest write to avoid 6 sequential SecureStore calls.
let manifestTimer: ReturnType<typeof setTimeout> | null = null;

function updateManifest() {
  if (Platform.OS === "web") return;
  const clientId = getPlatformConfig().cognitoClientId;
  if (!clientId) return;
  if (manifestTimer) clearTimeout(manifestTimer);
  manifestTimer = setTimeout(() => {
    manifestTimer = null;
    const keyPrefix = keyPrefixForClientId(clientId);
    const keys = [...memoryCache.keys()].filter((key) =>
      key.startsWith(keyPrefix),
    );
    SecureStore.setItemAsync(
      manifestKeyForClientId(clientId),
      JSON.stringify(keys),
      KEYCHAIN_ACCESSIBLE_OPTIONS,
    ).catch((e) => console.warn("[CognitoStorage] manifest write error:", e));
  }, 100);
}

/**
 * Clear session material for one Cognito app client. Environment entries keep
 * their own Cognito clientId, and Cognito token keys already include that
 * clientId, so clientId is the precise scope discriminator without changing
 * persisted token key names.
 */
export async function clearCognitoStorageForClientId(
  clientId: string,
): Promise<void> {
  const trimmedClientId = clientId.trim();
  if (!trimmedClientId) return;
  const keyPrefix = keyPrefixForClientId(trimmedClientId);

  if (Platform.OS === "web") {
    const toRemove: string[] = [];
    for (let i = 0; i < localStorage.length; i++) {
      const key = localStorage.key(i);
      if (key?.startsWith(keyPrefix) || key === manifestKeyForClientId(trimmedClientId)) {
        toRemove.push(key);
      }
    }
    toRemove.forEach((key) => localStorage.removeItem(key));
    return;
  }

  const keys = [...memoryCache.keys()].filter((key) =>
    key.startsWith(keyPrefix),
  );
  keys.forEach((key) => memoryCache.delete(key));
  await Promise.all([
    ...keys.map((key) =>
      SecureStore.deleteItemAsync(secureStoreKeyFor(key)).catch((e) =>
        console.warn("[CognitoStorage] scoped clear error:", e),
      ),
    ),
    SecureStore.deleteItemAsync(manifestKeyForClientId(trimmedClientId)).catch(
      () => undefined,
    ),
  ]);
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
    SecureStore.setItemAsync(
      secureStoreKeyFor(key),
      value,
      KEYCHAIN_ACCESSIBLE_OPTIONS,
    ).catch((e) => console.warn("[CognitoStorage] setItem error:", e));
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
    SecureStore.deleteItemAsync(secureStoreKeyFor(key)).catch((e) =>
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
      SecureStore.deleteItemAsync(secureStoreKeyFor(k)).catch((e) =>
        console.warn("[CognitoStorage] clear error:", e),
      ),
    );
    const clientIds = new Set(
      keys.flatMap((key) => {
        const match = key.match(/^CognitoIdentityServiceProvider\.([^.]+)\./);
        return match?.[1] ? [match[1]] : [];
      }),
    );
    clientIds.forEach((clientId) => {
      SecureStore.deleteItemAsync(manifestKeyForClientId(clientId)).catch(
        () => {},
      );
    });
    SecureStore.deleteItemAsync(`${PREFIX}.__manifest__`).catch(() => {});
    return {};
  },
};

function keyPrefixForClientId(clientId: string): string {
  return `${PREFIX}.${clientId}.`;
}

function manifestKeyForClientId(clientId: string): string {
  return `${PREFIX}.${clientId}.__manifest__`;
}

function addManifestKeys(target: Set<string>, manifestRaw: string | null) {
  if (!manifestRaw) return;
  try {
    const keys: unknown = JSON.parse(manifestRaw);
    if (Array.isArray(keys)) {
      keys.forEach((key) => {
        if (typeof key === "string") target.add(key);
      });
    }
  } catch {}
}
