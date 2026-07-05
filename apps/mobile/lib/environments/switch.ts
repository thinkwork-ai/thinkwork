import {
  clearAuthStorageForEnvironment,
  getStoredAuthTokenForActiveEnvironment,
} from "../auth";
import { setAuthToken } from "../graphql/client";
import {
  getActiveEnvironmentEntry,
  getEnvironmentEntries,
  removeEnvironment,
  setActiveEnvironment,
  type MobileEnvironmentEntry,
  type MobileEnvironmentStoreSnapshot,
} from "./store";

export type EnvironmentSwitchResult =
  | { status: "restored"; environment: MobileEnvironmentEntry; token: string }
  | { status: "needs-login"; environment: MobileEnvironmentEntry };

export type EnvironmentRemovalResult =
  | {
      status: "removed-active-fallback-restored";
      snapshot: MobileEnvironmentStoreSnapshot;
      switchResult: EnvironmentSwitchResult;
    }
  | {
      status: "removed-active-no-fallback";
      snapshot: MobileEnvironmentStoreSnapshot;
    }
  | {
      status: "removed-inactive";
      snapshot: MobileEnvironmentStoreSnapshot;
    };

export async function switchActiveEnvironment(
  id: string,
): Promise<EnvironmentSwitchResult> {
  const snapshot = await setActiveEnvironment(id);
  const environment = snapshot.activeEntry;
  if (!environment) {
    throw new Error(`Environment ${id} was not found.`);
  }

  const token = await getStoredAuthTokenForActiveEnvironment();
  if (!token) {
    setAuthToken(null);
    return { status: "needs-login", environment };
  }

  setAuthToken(token);
  return { status: "restored", environment, token };
}

/**
 * Picker-level removal orchestration. The store intentionally preserves its
 * lower-level contract of clearing activeEnvironmentId when the active entry
 * is removed; this wrapper adds product behavior: scoped session clear and
 * fallback selection for picker callers.
 */
export async function removeEnvironmentWithSessionCleanup(
  id: string,
): Promise<EnvironmentRemovalResult> {
  const before = getEnvironmentEntries();
  const removed = before.find((entry) => entry.id === id);
  if (!removed) {
    return { status: "removed-inactive", snapshot: await removeEnvironment(id) };
  }

  const wasActive = before.some(
    (entry) => entry.id === id && getActiveEnvironmentEntry()?.id === id,
  );
  const fallback = before.find((entry) => entry.id !== id) ?? null;

  await clearAuthStorageForEnvironment(removed.config.cognitoClientId);
  const snapshot = await removeEnvironment(id);

  if (!wasActive) return { status: "removed-inactive", snapshot };
  if (!fallback) {
    setAuthToken(null);
    return { status: "removed-active-no-fallback", snapshot };
  }

  const switchResult = await switchActiveEnvironment(fallback.id);
  return {
    status: "removed-active-fallback-restored",
    snapshot,
    switchResult,
  };
}
