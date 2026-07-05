import {
  getDeploymentProfileSnapshot,
  hydrateDeploymentProfile,
  runtimeConfigFromProfile,
  type MobileDeploymentProfileStorage,
} from "../deployment-profile";
import { normalizeEnvironmentHost } from "./url-normalize";
import type { EnvironmentRuntimeConfig } from "./runtime-config-fetch";

const ENVIRONMENTS_STORAGE_KEY = "thinkwork.environments.v1";

export interface MobileEnvironmentEntry {
  id: string;
  displayName: string;
  host: string;
  stage: string;
  region: string;
  config: EnvironmentRuntimeConfig;
  createdAt: string;
}

export interface MobileEnvironmentStoreSnapshot {
  entries: MobileEnvironmentEntry[];
  activeEnvironmentId: string | null;
  activeEntry: MobileEnvironmentEntry | null;
}

export type MobileEnvironmentStoreStorage = MobileDeploymentProfileStorage;

type EnvironmentStoreListener = (
  snapshot: MobileEnvironmentStoreSnapshot,
) => void;

let storage: MobileEnvironmentStoreStorage = defaultStorage();
let memoryStorage = new Map<string, string>();
let entries: MobileEnvironmentEntry[] = [];
let activeEnvironmentId: string | null = null;
let hydrated = false;
let hydratePromise: Promise<MobileEnvironmentStoreSnapshot> | null = null;
const listeners = new Set<EnvironmentStoreListener>();

export async function hydrateEnvironmentStore(): Promise<MobileEnvironmentStoreSnapshot> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const stored = await storage.getItem(ENVIRONMENTS_STORAGE_KEY);
    const parsed = parseStoredState(stored);
    entries = parsed.entries;
    activeEnvironmentId = parsed.activeEnvironmentId;

    if (entries.length === 0) {
      const migrated = await migrateLegacyProfile();
      if (migrated) {
        entries = [migrated];
        activeEnvironmentId = migrated.id;
        await persist();
      }
    }

    hydrated = true;
    return snapshot();
  })();
  return hydratePromise;
}

export function isEnvironmentStoreHydrated(): boolean {
  return hydrated;
}

export function getEnvironmentEntries(): MobileEnvironmentEntry[] {
  return entries.map(copyEntry);
}

export function getActiveEnvironmentEntry(): MobileEnvironmentEntry | null {
  const entry = entries.find((candidate) => candidate.id === activeEnvironmentId);
  return entry ? copyEntry(entry) : null;
}

export async function addOrUpdateEnvironment(input: {
  host: string;
  config: EnvironmentRuntimeConfig;
  displayName?: string | null;
  now?: Date | string;
}): Promise<MobileEnvironmentEntry> {
  await hydrateEnvironmentStore();
  const host = normalizeEnvironmentHost(input.host);
  const existingIndex = entries.findIndex((entry) => entry.host === host);
  const displayName =
    input.displayName?.trim() || displayNameFromConfig(host, input.config);
  const createdAt =
    existingIndex >= 0
      ? entries[existingIndex].createdAt
      : toIso(input.now ?? new Date());
  const entry: MobileEnvironmentEntry = {
    id: existingIndex >= 0 ? entries[existingIndex].id : environmentId(host),
    displayName,
    host,
    stage: input.config.stage.trim(),
    region: input.config.region.trim(),
    config: { ...input.config },
    createdAt,
  };

  if (existingIndex >= 0) {
    entries = entries.map((candidate, index) =>
      index === existingIndex ? entry : candidate,
    );
  } else {
    entries = [...entries, entry];
  }
  activeEnvironmentId = entry.id;
  await persistAndNotify();
  return copyEntry(entry);
}

export async function setActiveEnvironment(
  id: string | null,
): Promise<MobileEnvironmentStoreSnapshot> {
  await hydrateEnvironmentStore();
  if (id !== null && !entries.some((entry) => entry.id === id)) {
    throw new Error(`Environment ${id} was not found.`);
  }
  activeEnvironmentId = id;
  await persistAndNotify();
  return snapshot();
}

export async function removeEnvironment(
  id: string,
): Promise<MobileEnvironmentStoreSnapshot> {
  await hydrateEnvironmentStore();
  entries = entries.filter((entry) => entry.id !== id);
  if (activeEnvironmentId === id) activeEnvironmentId = null;
  await persistAndNotify();
  return snapshot();
}

export async function renameEnvironment(
  id: string,
  displayName: string,
): Promise<MobileEnvironmentEntry> {
  await hydrateEnvironmentStore();
  const trimmed = displayName.trim();
  if (!trimmed) {
    throw new Error("Environment display name cannot be empty.");
  }
  const entry = entries.find((candidate) => candidate.id === id);
  if (!entry) throw new Error(`Environment ${id} was not found.`);
  entries = entries.map((candidate) =>
    candidate.id === id ? { ...candidate, displayName: trimmed } : candidate,
  );
  await persistAndNotify();
  return copyEntry({ ...entry, displayName: trimmed });
}

export function subscribeEnvironmentStore(listener: EnvironmentStoreListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setEnvironmentStoreStorageForTests(
  adapter: MobileEnvironmentStoreStorage,
) {
  storage = adapter;
}

export function resetEnvironmentStoreForTests() {
  entries = [];
  activeEnvironmentId = null;
  hydrated = false;
  hydratePromise = null;
  memoryStorage = new Map<string, string>();
  storage = defaultStorage();
  listeners.clear();
}

async function migrateLegacyProfile(): Promise<MobileEnvironmentEntry | null> {
  await hydrateDeploymentProfile();
  const profile = getDeploymentProfileSnapshot().profile;
  if (!profile) return null;

  const host = normalizeEnvironmentHost(profile.spacesUrl);
  const config = runtimeConfigFromProfile(profile);
  return {
    id: environmentId(host),
    displayName: displayNameFromConfig(host, config),
    host,
    stage: config.stage.trim(),
    region: config.region.trim(),
    config,
    createdAt: profile.issuedAt,
  };
}

function parseStoredState(value: string | null): MobileEnvironmentStoreSnapshot {
  if (!value) return emptySnapshot();
  try {
    const parsed = JSON.parse(value) as Partial<MobileEnvironmentStoreSnapshot>;
    const parsedEntries = Array.isArray(parsed.entries)
      ? parsed.entries.filter(isEnvironmentEntry).map(copyEntry)
      : [];
    const parsedActiveId =
      typeof parsed.activeEnvironmentId === "string"
        ? parsed.activeEnvironmentId
        : null;
    return {
      entries: parsedEntries,
      activeEnvironmentId: parsedActiveId,
      activeEntry:
        parsedEntries.find((entry) => entry.id === parsedActiveId) ?? null,
    };
  } catch (error) {
    console.warn("[mobile:environments] ignoring stored environments", error);
    return emptySnapshot();
  }
}

async function persistAndNotify(): Promise<void> {
  await persist();
  notify();
}

async function persist(): Promise<void> {
  await storage.setItem(
    ENVIRONMENTS_STORAGE_KEY,
    JSON.stringify(
      {
        entries,
        activeEnvironmentId,
      },
      null,
      2,
    ),
  );
}

function snapshot(): MobileEnvironmentStoreSnapshot {
  const copiedEntries = entries.map(copyEntry);
  return {
    entries: copiedEntries,
    activeEnvironmentId,
    activeEntry:
      copiedEntries.find((entry) => entry.id === activeEnvironmentId) ?? null,
  };
}

function emptySnapshot(): MobileEnvironmentStoreSnapshot {
  return {
    entries: [],
    activeEnvironmentId: null,
    activeEntry: null,
  };
}

function notify() {
  const current = snapshot();
  listeners.forEach((listener) => listener(current));
}

function copyEntry(entry: MobileEnvironmentEntry): MobileEnvironmentEntry {
  return {
    ...entry,
    config: { ...entry.config },
  };
}

function isEnvironmentEntry(value: unknown): value is MobileEnvironmentEntry {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  const entry = value as Partial<MobileEnvironmentEntry>;
  return (
    typeof entry.id === "string" &&
    typeof entry.displayName === "string" &&
    typeof entry.host === "string" &&
    typeof entry.stage === "string" &&
    typeof entry.region === "string" &&
    typeof entry.createdAt === "string" &&
    Boolean(entry.config) &&
    typeof entry.config === "object"
  );
}

function displayNameFromConfig(
  host: string,
  config: EnvironmentRuntimeConfig,
): string {
  return config.displayName.trim() || config.stage.trim() || host;
}

function environmentId(host: string): string {
  let hash = 0x811c9dc5;
  for (let index = 0; index < host.length; index += 1) {
    hash ^= host.charCodeAt(index);
    hash = Math.imul(hash, 0x01000193);
  }
  return `env-${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function toIso(value: Date | string): string {
  if (value instanceof Date) return value.toISOString();
  return value.trim() || new Date().toISOString();
}

function defaultStorage(): MobileEnvironmentStoreStorage {
  return {
    async getItem(key) {
      const web = webLocalStorage();
      if (web) return web.getItem(key);
      const native = await asyncStorage();
      if (native) return native.getItem(key);
      return memoryStorage.get(key) ?? null;
    },
    async setItem(key, value) {
      const web = webLocalStorage();
      if (web) {
        web.setItem(key, value);
        return;
      }
      const native = await asyncStorage();
      if (native) {
        await native.setItem(key, value);
        return;
      }
      memoryStorage.set(key, value);
    },
    async removeItem(key) {
      const web = webLocalStorage();
      if (web) {
        web.removeItem(key);
        return;
      }
      const native = await asyncStorage();
      if (native) {
        await native.removeItem(key);
        return;
      }
      memoryStorage.delete(key);
    },
  };
}

function webLocalStorage(): Storage | null {
  try {
    return typeof localStorage === "undefined" ? null : localStorage;
  } catch {
    return null;
  }
}

async function asyncStorage(): Promise<{
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
} | null> {
  try {
    const module = await import("@react-native-async-storage/async-storage");
    return module.default;
  } catch {
    return null;
  }
}
