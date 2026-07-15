/**
 * THINK-173 U6 — capabilities manifest workspace-file reader.
 *
 * Reads the render-compiled, content-addressed capabilities manifest
 * from `<workspaceDir>/capabilities/<fingerprint>.json` — the exact
 * bytes the dispatch payload pinned via
 * `capabilities_manifest_fingerprint` (KTD-1: in-flight turns keep
 * their pinned manifest across mid-turn edits).
 *
 * Manifest mode is LOUD by contract (R9): the fingerprint field is only
 * dispatched for agents whose `capability_folder_dispatch` flag is on,
 * so a missing file, malformed JSON, wrong shape, or failed signature
 * verification throws `CapabilitiesJsonError` — the trusted handler
 * surfaces it as a structured 500 (same path as `McpJsonError`), never
 * a silent fall-back to the legacy capability path.
 *
 * Verification mirrors packages/api's `sidecar-signing.ts`: the render
 * pipeline signs the canonical (recursively key-sorted, no-whitespace)
 * JSON of the meaningful body `{version, agent, active, withheld}` with
 * the platform's Ed25519 PRIVATE key; this container holds only the
 * PUBLIC key (`CAPABILITY_SIGNING_PUBLIC_KEY`, SPKI PEM). Asymmetry is
 * the point (KTD-3): a symmetric verify key in this shared multi-tenant
 * container would itself be a forge key. An unset public key fails
 * CLOSED for any manifest-mode invocation.
 */

import { readFile } from "node:fs/promises";
import { createHash, createPublicKey, verify as edVerify } from "node:crypto";
import path from "node:path";

export const CAPABILITIES_MANIFEST_VERSION = 1;
export const CAPABILITY_SIGNING_PUBLIC_KEY_ENV =
  "CAPABILITY_SIGNING_PUBLIC_KEY";

export type CapabilityManifestToolKind =
  | "binding"
  | "platform"
  | "extension"
  | "script";

export interface CapabilityManifestEntry {
  name: string;
  slug: string;
  class: "builtin" | "skill" | "connection" | "tool" | "agent";
  description?: string;
  kind?: CapabilityManifestToolKind;
  target?: string;
  connection?: string;
  operation?: string;
  presetArgs?: Record<string, unknown>;
  output?: { model?: string; thread?: string };
  platformTool?: string;
  extension?: string;
  extensionTool?: string;
  entry?: string;
  [key: string]: unknown;
}

export interface CapabilitiesManifestFile {
  version: number;
  fingerprint: string;
  agent: { tenant_id?: string; agent_slug?: string };
  active: CapabilityManifestEntry[];
  withheld: Array<Record<string, unknown>>;
  signature: {
    version: number;
    algorithm: string;
    payloadHash: string;
    signature: string;
    signed_by: string;
    signed_at: string;
  } | null;
  [key: string]: unknown;
}

export class CapabilitiesJsonError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "CapabilitiesJsonError";
  }
}

export function capabilitiesManifestRelPath(fingerprint: string): string {
  return path.join("capabilities", `${fingerprint}.json`);
}

/**
 * Canonical JSON — MUST match packages/api's `canonicalizePayload`
 * (recursively key-sorted, `undefined` values dropped, no whitespace).
 * Signature verification depends on byte-identical canonicalization.
 */
export function canonicalizeManifestBody(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const record = value as Record<string, unknown>;
    const out: Record<string, unknown> = {};
    for (const key of Object.keys(record).sort()) {
      if (record[key] === undefined) continue;
      out[key] = sortValue(record[key]);
    }
    return out;
  }
  return value;
}

/** Env read wrapped in a function — vitest stubs env after import. */
function publicKeyPemFromEnv(): string | null {
  const raw = process.env[CAPABILITY_SIGNING_PUBLIC_KEY_ENV] || "";
  if (!raw.trim()) return null;
  // Terraform/SSM often carries PEMs with literal \n escapes.
  return raw.includes("\\n") ? raw.replace(/\\n/g, "\n") : raw;
}

export interface ReadCapabilitiesManifestDeps {
  /** Injectable for tests; defaults to the env-var read above. */
  publicKeyPem?: () => string | null;
}

export async function readCapabilitiesManifest(
  workspaceDir: string,
  fingerprint: string,
  deps: ReadCapabilitiesManifestDeps = {},
): Promise<CapabilitiesManifestFile> {
  if (!/^[a-f0-9]{16,128}$/i.test(fingerprint)) {
    throw new CapabilitiesJsonError(
      `capabilities manifest fingerprint is malformed: ${JSON.stringify(fingerprint)}`,
    );
  }
  const relPath = capabilitiesManifestRelPath(fingerprint);
  const filePath = path.join(workspaceDir, relPath);
  let raw: string;
  try {
    raw = await readFile(filePath, "utf-8");
  } catch {
    // Manifest mode is loud: the dispatch pinned this exact fingerprint,
    // so an absent file is a broken invariant, not a legacy fallback.
    throw new CapabilitiesJsonError(
      `${relPath}: pinned capabilities manifest is missing from the synced workspace.`,
    );
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (err) {
    throw new CapabilitiesJsonError(
      `${relPath}: invalid JSON (${err instanceof Error ? err.message : String(err)}).`,
    );
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new CapabilitiesJsonError(
      `${relPath}: top-level value must be a JSON object.`,
    );
  }
  const manifest = parsed as Record<string, unknown>;
  if (manifest.version !== CAPABILITIES_MANIFEST_VERSION) {
    throw new CapabilitiesJsonError(
      `${relPath}: unsupported manifest version ${String(manifest.version)}.`,
    );
  }
  if (!Array.isArray(manifest.active) || !Array.isArray(manifest.withheld)) {
    throw new CapabilitiesJsonError(
      `${relPath}: \`active\` and \`withheld\` must be arrays.`,
    );
  }
  if (
    !manifest.agent ||
    typeof manifest.agent !== "object" ||
    Array.isArray(manifest.agent)
  ) {
    throw new CapabilitiesJsonError(`${relPath}: \`agent\` must be an object.`);
  }
  for (const [index, entry] of (manifest.active as unknown[]).entries()) {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) {
      throw new CapabilitiesJsonError(
        `${relPath}: \`active[${index}]\` must be an object.`,
      );
    }
    const record = entry as Record<string, unknown>;
    if (typeof record.name !== "string" || typeof record.class !== "string") {
      throw new CapabilitiesJsonError(
        `${relPath}: \`active[${index}]\` is missing name/class.`,
      );
    }
  }

  verifyManifestSignature(manifest, relPath, deps);
  return manifest as unknown as CapabilitiesManifestFile;
}

function verifyManifestSignature(
  manifest: Record<string, unknown>,
  relPath: string,
  deps: ReadCapabilitiesManifestDeps,
): void {
  const pem = (deps.publicKeyPem ?? publicKeyPemFromEnv)();
  if (!pem) {
    // Fail CLOSED: a manifest-mode invocation without a verification key
    // must not register unverified capability state.
    throw new CapabilitiesJsonError(
      `${relPath}: ${CAPABILITY_SIGNING_PUBLIC_KEY_ENV} is not configured — ` +
        `cannot verify the manifest envelope; refusing unverified capabilities.`,
    );
  }

  const signature = manifest.signature;
  if (!signature || typeof signature !== "object" || Array.isArray(signature)) {
    throw new CapabilitiesJsonError(
      `${relPath}: manifest carries no signature envelope.`,
    );
  }
  const envelope = signature as Record<string, unknown>;
  if (
    envelope.version !== 1 ||
    envelope.algorithm !== "Ed25519" ||
    typeof envelope.payloadHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(envelope.payloadHash) ||
    typeof envelope.signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(envelope.signature) ||
    typeof envelope.signed_by !== "string"
  ) {
    throw new CapabilitiesJsonError(
      `${relPath}: manifest signature envelope is malformed.`,
    );
  }

  const canonical = canonicalizeManifestBody({
    version: manifest.version,
    agent: manifest.agent,
    active: manifest.active,
    withheld: manifest.withheld,
  });
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  if (payloadHash !== envelope.payloadHash.toLowerCase()) {
    throw new CapabilitiesJsonError(
      `${relPath}: manifest bytes do not match the signed payload hash.`,
    );
  }

  let verified = false;
  try {
    verified = edVerify(
      null,
      Buffer.from(canonical, "utf8"),
      createPublicKey(pem),
      Buffer.from(envelope.signature, "hex"),
    );
  } catch {
    verified = false;
  }
  if (!verified) {
    throw new CapabilitiesJsonError(
      `${relPath}: manifest signature failed Ed25519 verification.`,
    );
  }
}
