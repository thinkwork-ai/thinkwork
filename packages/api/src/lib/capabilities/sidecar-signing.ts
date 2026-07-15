/**
 * Platform signing for capability sidecars and the compiled capabilities
 * manifest (THINK-173 plan U1, KTD-3).
 *
 * The scheme is asymmetric (Ed25519) by requirement, not preference: the
 * verifier runs inside the shared multi-tenant Pi container, and with a
 * symmetric MAC the verify key IS the forge key. The private key never
 * leaves the platform side (`CAPABILITY_SIGNING_PRIVATE_KEY`, PKCS8 PEM);
 * the container is provisioned with only the public key
 * (`CAPABILITY_SIGNING_PUBLIC_KEY`, SPKI PEM). This intentionally does
 * NOT reuse `skill-trust/signing.ts` — that signer is HMAC-SHA256, which
 * KTD-3 rules out for this trust boundary.
 *
 * Signing is restricted to three authorized platform call sites (KTD-3):
 * the grant/approve resolver path (operator-authorized), the U11
 * backfill (operator-invoked CLI), and the plugin-cutover reconciler
 * (authority derived from the original plugin approval). The envelope
 * records which via `signed_by`.
 *
 * Two-layer enforcement (R18): the envelope signs the canonical sidecar
 * payload, and the payload pins `signed_content_sha` — the sha256 of the
 * definition file bytes reviewed at approval time. Verification reports
 * typed reasons in the existing gate-reason taxonomy:
 * `invalid_signature` (envelope broken/forged/tampered payload) and
 * `definition_drift` (valid envelope, definition bytes changed since
 * approval).
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { getConfig, getSecret } from "@thinkwork/runtime-config";

export const CAPABILITY_SIGNATURE_VERSION = 1;
export const CAPABILITY_SIGNATURE_ALGORITHM = "Ed25519";

/**
 * Provenance of a signature. Sidecars are signed only by the three
 * authorized call sites (operator resolvers, backfill, plugin
 * reconciler); `render` is reserved for the compiled manifest's own
 * envelope, which the render pipeline signs (U2) and the runtime
 * verifies (U6).
 */
export type CapabilitySignedBy =
  | `operator:${string}`
  // Autonomous self-extension: an agent self-admitted an auto-tier (public,
  // read-only, no-credential) capability with no human. The composing agent id
  // follows the prefix; the admission_mode column carries the same provenance.
  | `autonomous:${string}`
  | "backfill"
  | "plugin-reconciler"
  | "render"
  // THINK-229 U2: analyst caller contexts minted by trusted API handlers
  // at dispatch/refresh time. Domain separation from sidecars is the
  // in-payload `kind` tag (signed bytes), not this transport field.
  | "api-dispatch";

export interface CapabilitySignatureEnvelope {
  version: number;
  algorithm: typeof CAPABILITY_SIGNATURE_ALGORITHM;
  /** sha256 hex of the canonical payload bytes the signature covers. */
  payloadHash: string;
  signature: string;
  signed_by: CapabilitySignedBy;
  signed_at: string;
}

export type CapabilityVerifyResult =
  | { ok: true }
  | { ok: false; reason: "invalid_signature" | "definition_drift" };

export interface CapabilitySigner {
  signPayload(
    payload: Record<string, unknown>,
    input: {
      signedBy: CapabilitySignedBy;
    },
  ): CapabilitySignatureEnvelope;
}

export interface CapabilityVerifier {
  verifyPayload(payload: Record<string, unknown>, envelope: unknown): boolean;
}

/** sha256 hex of definition-file bytes — the R18 pin value. */
export function definitionContentSha(bytes: Buffer | string): string {
  return createHash("sha256").update(bytes).digest("hex");
}

/**
 * Canonical JSON: recursively key-sorted, no whitespace. The signature
 * must not depend on serialization order or pretty-printing.
 */
export function canonicalizePayload(value: unknown): string {
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

/**
 * Platform-side signer. Returns null when no private key is configured —
 * callers treat that as "signing unavailable" and must not fall back to
 * writing unsigned registration-grade state.
 */
export function createConfiguredCapabilitySigner(): CapabilitySigner | null {
  const pem = readKeyConfig("CAPABILITY_SIGNING_PRIVATE_KEY");
  if (!pem) return null;
  let key: KeyObject;
  try {
    key = createPrivateKey(pem);
  } catch {
    return null;
  }
  return capabilitySignerFromKey(key);
}

/**
 * Async signer resolution: direct key first (env/document — tests, local),
 * then the Secrets Manager indirection `CAPABILITY_SIGNING_PRIVATE_KEY_SECRET`
 * (the terraform-provisioned path — the PEM never enters the Lambda env,
 * which sits at the 4KB ceiling, nor the SSM String document). Null =
 * signing unavailable; callers fail loudly, never write unsigned
 * registration-grade state.
 */
export async function resolveConfiguredCapabilitySigner(): Promise<CapabilitySigner | null> {
  const direct = createConfiguredCapabilitySigner();
  if (direct) return direct;
  const secretName = readKeyConfig("CAPABILITY_SIGNING_PRIVATE_KEY_SECRET");
  if (!secretName) return null;
  try {
    const pem = await getSecret(secretName.trim());
    if (!pem?.trim()) return null;
    return capabilitySignerFromKey(
      createPrivateKey(pem.includes("\\n") ? pem.replace(/\\n/g, "\n") : pem),
    );
  } catch {
    return null;
  }
}

/** Test/backfill entry — sign with an explicit key object. */
export function capabilitySignerFromKey(
  privateKey: KeyObject,
): CapabilitySigner {
  return {
    signPayload(payload, input) {
      const canonical = canonicalizePayload(payload);
      const payloadHash = createHash("sha256").update(canonical).digest("hex");
      const signature = edSign(
        null,
        Buffer.from(canonical, "utf8"),
        privateKey,
      ).toString("hex");
      return {
        version: CAPABILITY_SIGNATURE_VERSION,
        algorithm: CAPABILITY_SIGNATURE_ALGORITHM,
        payloadHash,
        signature,
        signed_by: input.signedBy,
        signed_at: new Date().toISOString(),
      };
    },
  };
}

/**
 * Verifier over the public key only — safe to construct anywhere,
 * including the multi-tenant runtime container.
 */
export function createConfiguredCapabilityVerifier(): CapabilityVerifier | null {
  const pem = readKeyConfig("CAPABILITY_SIGNING_PUBLIC_KEY");
  if (!pem) return null;
  let key: KeyObject;
  try {
    key = createPublicKey(pem);
  } catch {
    return null;
  }
  return capabilityVerifierFromKey(key);
}

export function capabilityVerifierFromKey(
  publicKey: KeyObject,
): CapabilityVerifier {
  return {
    verifyPayload(payload, envelope) {
      const parsed = parseCapabilitySignatureEnvelope(envelope);
      if (!parsed) return false;
      const canonical = canonicalizePayload(payload);
      const payloadHash = createHash("sha256").update(canonical).digest("hex");
      if (payloadHash !== parsed.payloadHash) return false;
      try {
        return edVerify(
          null,
          Buffer.from(canonical, "utf8"),
          publicKey,
          Buffer.from(parsed.signature, "hex"),
        );
      } catch {
        return false;
      }
    },
  };
}

/**
 * Sign a sidecar: pins the definition bytes (R18) and wraps the whole
 * canonical sidecar payload (minus the envelope itself) in a signature.
 * Returns the fields to persist on the sidecar.
 */
export function signCapabilitySidecar(input: {
  signer: CapabilitySigner;
  /** Sidecar payload WITHOUT `signature` (it is derived here). */
  sidecar: Record<string, unknown>;
  /** Definition file bytes reviewed at approval time. */
  definitionBytes: Buffer | string;
  signedBy: CapabilitySignedBy;
}): {
  signed_content_sha: string;
  signature: CapabilitySignatureEnvelope;
} {
  const signed_content_sha = definitionContentSha(input.definitionBytes);
  const { signature: _drop, ...rest } = input.sidecar;
  const payload = { ...rest, signed_content_sha };
  const signature = input.signer.signPayload(payload, {
    signedBy: input.signedBy,
  });
  return { signed_content_sha, signature };
}

/**
 * Verify a signed sidecar against the current definition bytes.
 * Signature validity is checked first (a broken envelope is
 * `invalid_signature` even when the content also drifted); an intact
 * signature over stale definition bytes is `definition_drift`.
 */
export function verifyCapabilitySidecar(input: {
  verifier: CapabilityVerifier;
  /** Full sidecar including `signature` and `signed_content_sha`. */
  sidecar: Record<string, unknown>;
  /** Current definition file bytes from the workspace. */
  definitionBytes: Buffer | string;
}): CapabilityVerifyResult {
  const { signature, ...payload } = input.sidecar;
  if (!signature) return { ok: false, reason: "invalid_signature" };
  if (!input.verifier.verifyPayload(payload, signature)) {
    return { ok: false, reason: "invalid_signature" };
  }
  const pinned = payload.signed_content_sha;
  if (
    typeof pinned !== "string" ||
    pinned.toLowerCase() !==
      definitionContentSha(input.definitionBytes).toLowerCase()
  ) {
    return { ok: false, reason: "definition_drift" };
  }
  return { ok: true };
}

export function parseCapabilitySignatureEnvelope(
  raw: unknown,
): CapabilitySignatureEnvelope | null {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return null;
  const record = raw as Partial<
    Record<keyof CapabilitySignatureEnvelope, unknown>
  >;
  if (record.version !== CAPABILITY_SIGNATURE_VERSION) return null;
  if (record.algorithm !== CAPABILITY_SIGNATURE_ALGORITHM) return null;
  if (
    typeof record.payloadHash !== "string" ||
    !/^[a-f0-9]{64}$/i.test(record.payloadHash)
  ) {
    return null;
  }
  if (
    typeof record.signature !== "string" ||
    !/^[a-f0-9]{128}$/i.test(record.signature)
  ) {
    return null;
  }
  if (typeof record.signed_by !== "string" || record.signed_by === "") {
    return null;
  }
  if (
    record.signed_by !== "backfill" &&
    record.signed_by !== "plugin-reconciler" &&
    record.signed_by !== "render" &&
    record.signed_by !== "api-dispatch" &&
    !record.signed_by.startsWith("operator:") &&
    !record.signed_by.startsWith("autonomous:")
  ) {
    return null;
  }
  if (typeof record.signed_at !== "string") return null;
  return {
    version: CAPABILITY_SIGNATURE_VERSION,
    algorithm: CAPABILITY_SIGNATURE_ALGORITHM,
    payloadHash: record.payloadHash.toLowerCase(),
    signature: record.signature.toLowerCase(),
    signed_by: record.signed_by as CapabilitySignedBy,
    signed_at: record.signed_at,
  };
}

function readKeyConfig(name: string): string | null {
  let value = "";
  try {
    value = getConfig(name) || "";
  } catch {
    value = "";
  }
  if (!value.trim()) value = process.env[name] || "";
  if (!value.trim()) return null;
  // Terraform/SSM often carries PEMs with literal \n escapes.
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}
