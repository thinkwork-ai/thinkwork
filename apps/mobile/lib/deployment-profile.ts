import {
  parseDeploymentProfileJson,
  profileToRuntimeConfig,
  verifyDeploymentProfile,
  type DeploymentProfile,
  type DeploymentProfileTrustStatus,
  type DeploymentProfileValidationIssue,
  type DeploymentProfileValidationOptions,
  type DeploymentProfileValidationResult,
  type TrustedDeploymentProfileKey,
} from "@thinkwork/deployment-profile";

const PROFILE_STORAGE_KEY = "thinkwork.deploymentProfile.v1";

export interface MobileDeploymentProfileStorage {
  getItem(key: string): Promise<string | null>;
  setItem(key: string, value: string): Promise<void>;
  removeItem(key: string): Promise<void>;
}

export interface MobileDeploymentProfileSummary {
  source: "profile" | "env";
  deploymentId: string | null;
  displayName: string;
  stage: string;
  region: string | null;
  profileSha256: string | null;
  trustStatus: DeploymentProfileTrustStatus;
  trustLabel: string;
}

export interface MobileDeploymentProfileSnapshot {
  profile: DeploymentProfile | null;
  profileJson: string | null;
  profileSha256: string | null;
  status: DeploymentProfileTrustStatus;
  issues: DeploymentProfileValidationIssue[];
  trustLabel: string;
  summary: MobileDeploymentProfileSummary | null;
}

type ProfileListener = (snapshot: MobileDeploymentProfileSnapshot) => void;

let storage: MobileDeploymentProfileStorage = defaultStorage();
let activeJson: string | null = null;
let activeSnapshot: MobileDeploymentProfileSnapshot | null = null;
let hydrated = false;
let hydratePromise: Promise<MobileDeploymentProfileSnapshot> | null = null;
let memoryStorage = new Map<string, string>();
const listeners = new Set<ProfileListener>();

export async function hydrateDeploymentProfile(): Promise<MobileDeploymentProfileSnapshot> {
  if (hydratePromise) return hydratePromise;
  hydratePromise = (async () => {
    const stored = await storage.getItem(PROFILE_STORAGE_KEY);
    if (!stored) {
      activeJson = null;
      activeSnapshot = emptySnapshot();
      hydrated = true;
      return activeSnapshot;
    }

    const result = await validateProfileJson(stored);
    if (!result.ok || !result.profile) {
      console.warn(
        "[mobile:deployment-profile] ignoring stored deployment profile",
        result.issues[0]?.message ?? result.status,
      );
      activeJson = null;
      activeSnapshot = emptySnapshot();
      hydrated = true;
      return activeSnapshot;
    }

    activeJson = normalizedProfileJson(result.profile);
    activeSnapshot = snapshotFromResult(result, activeJson);
    hydrated = true;
    return activeSnapshot;
  })();
  return hydratePromise;
}

export function getDeploymentProfileSnapshot(): MobileDeploymentProfileSnapshot {
  return activeSnapshot ?? emptySnapshot();
}

export function isDeploymentProfileHydrated(): boolean {
  return hydrated;
}

export async function importDeploymentProfile(
  input: string,
): Promise<MobileDeploymentProfileSnapshot> {
  const json = extractProfileJson(input);
  const result = await validateProfileJson(json);
  if (!result.ok || !result.profile) {
    throw new Error(
      result.issues[0]?.message ?? "Deployment profile could not be validated.",
    );
  }

  activeJson = normalizedProfileJson(result.profile);
  activeSnapshot = snapshotFromResult(result, activeJson);
  hydrated = true;
  hydratePromise = Promise.resolve(activeSnapshot);
  await storage.setItem(PROFILE_STORAGE_KEY, activeJson);
  notify(activeSnapshot);
  return activeSnapshot;
}

export async function removeDeploymentProfile(): Promise<MobileDeploymentProfileSnapshot> {
  activeJson = null;
  activeSnapshot = emptySnapshot();
  hydrated = true;
  hydratePromise = Promise.resolve(activeSnapshot);
  await storage.removeItem(PROFILE_STORAGE_KEY);
  notify(activeSnapshot);
  return activeSnapshot;
}

export function subscribeDeploymentProfile(listener: ProfileListener) {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function setDeploymentProfileStorageForTests(
  adapter: MobileDeploymentProfileStorage,
) {
  storage = adapter;
}

export function resetDeploymentProfileForTests() {
  activeJson = null;
  activeSnapshot = null;
  hydrated = false;
  hydratePromise = null;
  memoryStorage = new Map<string, string>();
  storage = defaultStorage();
  listeners.clear();
}

export function extractProfileJson(input: string): string {
  const trimmed = input.trim();
  if (!trimmed) throw new Error("Deployment profile JSON is empty.");
  if (trimmed.startsWith("{")) return trimmed;

  try {
    const url = new URL(trimmed);
    const encoded = url.searchParams.get("profile");
    const json = url.searchParams.get("json");
    if (encoded && json) {
      throw new Error("Deployment profile link includes two profile payloads.");
    }
    if (json) return json;
    if (encoded) return decodeBase64Url(encoded);
  } catch (error) {
    if (error instanceof Error && error.message.includes("payload")) {
      throw error;
    }
  }

  throw new Error("Paste a deployment profile JSON document or profile link.");
}

export async function validateProfileJson(
  json: string,
): Promise<DeploymentProfileValidationResult> {
  const structural = parseDeploymentProfileJson(json, validationOptions());
  if (!structural.profile || !structural.profile.signature) return structural;

  const trustedKeys = parseTrustedKeysFromEnvironment();
  if (trustedKeys.length === 0) {
    if (isProduction()) {
      return {
        ...structural,
        ok: false,
        status: "unknown_key",
        trust: null,
        issues: [
          {
            status: "unknown_key",
            field: "signature.keyId",
            message:
              "Deployment profile is signed, but this mobile build has no trusted profile signing keys configured.",
          },
        ],
      };
    }
    return structural;
  }

  return verifyDeploymentProfile(
    structural.profile,
    trustedKeys,
    validationOptions(),
  );
}

function validationOptions(): DeploymentProfileValidationOptions {
  const allowDevelopmentFallback = !isProduction();
  return {
    allowUnsigned: allowDevelopmentFallback,
    allowHttpLocalhost: allowDevelopmentFallback,
  };
}

function snapshotFromResult(
  result: DeploymentProfileValidationResult,
  profileJson: string,
): MobileDeploymentProfileSnapshot {
  if (!result.profile) return emptySnapshot(result);
  return {
    profile: result.profile,
    profileJson,
    profileSha256: result.profileSha256,
    status: result.status,
    issues: result.issues,
    trustLabel: trustLabel(result),
    summary: profileSummary(result),
  };
}

function emptySnapshot(
  result?: DeploymentProfileValidationResult,
): MobileDeploymentProfileSnapshot {
  return {
    profile: null,
    profileJson: null,
    profileSha256: result?.profileSha256 ?? null,
    status: result?.status ?? "unsigned",
    issues: result?.issues ?? [],
    trustLabel: "Build-time fallback",
    summary: null,
  };
}

function profileSummary(
  result: DeploymentProfileValidationResult,
): MobileDeploymentProfileSummary {
  const profile = result.profile;
  if (!profile) throw new Error("Deployment profile was not loaded.");
  return {
    source: "profile",
    deploymentId: profile.deploymentId,
    displayName: profile.displayName,
    stage: profile.stage,
    region: profile.region,
    profileSha256: result.profileSha256,
    trustStatus: result.status,
    trustLabel: trustLabel(result),
  };
}

export function runtimeConfigFromProfile(profile: DeploymentProfile) {
  return profileToRuntimeConfig(profile);
}

function trustLabel(result: DeploymentProfileValidationResult): string {
  if (result.status === "trusted") {
    return result.trust?.keyId
      ? `Signed by ${result.trust.keyId}`
      : "Signed deployment profile";
  }
  if (result.status === "unsigned") return "Unsigned development profile";
  return result.issues[0]?.message ?? result.status;
}

function normalizedProfileJson(profile: DeploymentProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function notify(snapshot: MobileDeploymentProfileSnapshot) {
  listeners.forEach((listener) => listener(snapshot));
}

function isProduction(): boolean {
  return process.env.NODE_ENV === "production";
}

function parseTrustedKeysFromEnvironment(): readonly TrustedDeploymentProfileKey[] {
  const raw =
    process.env.EXPO_PUBLIC_DEPLOYMENT_PROFILE_TRUSTED_KEYS_JSON ??
    process.env.THINKWORK_DEPLOYMENT_PROFILE_TRUSTED_KEYS_JSON;
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.filter(
      (value): value is TrustedDeploymentProfileKey =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as TrustedDeploymentProfileKey).keyId === "string" &&
        typeof (value as TrustedDeploymentProfileKey).publicKeyPem ===
          "string" &&
        typeof (value as TrustedDeploymentProfileKey).issuer === "string",
    );
  } catch (error) {
    console.warn(
      "[mobile:deployment-profile] ignored malformed trusted keys env",
      error,
    );
    return [];
  }
}

function decodeBase64Url(value: string): string {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(
    base64.length + ((4 - (base64.length % 4)) % 4),
    "=",
  );
  if (typeof atob === "function") {
    return decodeURIComponent(
      Array.from(atob(padded))
        .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
        .join(""),
    );
  }
  return decodeURIComponent(
    Array.from(decodeBase64Ascii(padded))
      .map((char) => `%${char.charCodeAt(0).toString(16).padStart(2, "0")}`)
      .join(""),
  );
}

function decodeBase64Ascii(value: string): string {
  const alphabet =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  let buffer = 0;
  let bits = 0;
  let output = "";
  for (const char of value.replace(/=+$/, "")) {
    const index = alphabet.indexOf(char);
    if (index < 0) throw new Error("Deployment profile link is not base64.");
    buffer = (buffer << 6) | index;
    bits += 6;
    if (bits >= 8) {
      bits -= 8;
      output += String.fromCharCode((buffer >> bits) & 0xff);
    }
  }
  return output;
}

function defaultStorage(): MobileDeploymentProfileStorage {
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
