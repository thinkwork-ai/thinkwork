/**
 * turn-assertion — KMS-signed turn identity for Pi runtime callbacks
 * (THINK-324 Wave-3 C18).
 *
 * The dispatch Lambdas mint a short-lived assertion binding
 * {tenant_id, thread_id, turn_id} and thread it through the invoke payload
 * (`turn_assertion` dispatch field). The runtime echoes it verbatim on its
 * HTTP callbacks (`x-thinkwork-turn-assertion` header); API handlers verify
 * the signature AND that the assertion's binding matches the request body,
 * so the shared API_AUTH_SECRET alone can no longer forge evidence for
 * arbitrary turns.
 *
 * Key custody: an asymmetric KMS SIGN_VERIFY key (ECC_NIST_P256,
 * `alias/thinkwork-<stage>-turn-assertion`). Sign happens inside KMS — the
 * private key is non-exportable, so a compromised Lambda cannot exfiltrate
 * the signer. Verification is LOCAL: the public key is fetched once via
 * kms:GetPublicKey and cached per container, so verify adds no per-request
 * KMS call.
 *
 * Token format: `twta1.<b64url(payload json)>.<b64url(DER ECDSA sig)>`.
 *
 * Fail-open mint, tolerant verify (C18 rollout posture): a missing key id or
 * KMS error yields `null` (payload field drops out) and handlers accept
 * assertion-less requests with a structured log. C19 flips the governed
 * surfaces to required.
 */

import {
  GetPublicKeyCommand,
  KMSClient,
  SignCommand,
} from "@aws-sdk/client-kms";
import { createPublicKey, verify as cryptoVerify, type KeyObject } from "node:crypto";

export const TURN_ASSERTION_HEADER = "x-thinkwork-turn-assertion";
const TOKEN_PREFIX = "twta1";
const DEFAULT_TTL_SECONDS = 2 * 60 * 60; // generous: long agent turns

export interface TurnAssertionBinding {
  tenant_id: string;
  thread_id: string;
  turn_id: string;
}

interface TurnAssertionPayload extends TurnAssertionBinding {
  iat: number;
  exp: number;
}

let kmsClient: KMSClient | null = null;
function getKms(): KMSClient {
  if (!kmsClient) kmsClient = new KMSClient({});
  return kmsClient;
}

/** Test-only: reset module caches between test cases. */
export function __resetTurnAssertionCaches(): void {
  kmsClient = null;
  cachedPublicKey = null;
  cachedPublicKeyId = null;
}

function keyId(): string {
  return process.env.AGENTCORE_TURN_ASSERTION_KMS_KEY_ID || "";
}

function b64url(buf: Buffer): string {
  return buf.toString("base64url");
}

/**
 * Mint a signed turn assertion. Returns null — never throws — when the key
 * is unconfigured or KMS signing fails: dispatch must not depend on the
 * assertion plane being up.
 */
export async function mintTurnAssertion(
  binding: TurnAssertionBinding,
  deps: { kms?: Pick<KMSClient, "send">; now?: Date; ttlSeconds?: number } = {},
): Promise<string | null> {
  const key = keyId();
  if (!key) return null;
  if (!binding.tenant_id || !binding.thread_id || !binding.turn_id) return null;
  const nowSec = Math.floor((deps.now ?? new Date()).getTime() / 1000);
  const payload: TurnAssertionPayload = {
    tenant_id: binding.tenant_id,
    thread_id: binding.thread_id,
    turn_id: binding.turn_id,
    iat: nowSec,
    exp: nowSec + (deps.ttlSeconds ?? DEFAULT_TTL_SECONDS),
  };
  const message = Buffer.from(JSON.stringify(payload), "utf8");
  try {
    const kms = deps.kms ?? getKms();
    const result = await kms.send(
      new SignCommand({
        KeyId: key,
        Message: message,
        MessageType: "RAW",
        SigningAlgorithm: "ECDSA_SHA_256",
      }),
    );
    if (!result.Signature) return null;
    return `${TOKEN_PREFIX}.${b64url(message)}.${b64url(Buffer.from(result.Signature))}`;
  } catch (err) {
    console.warn(
      "[turn-assertion] mint failed (fail-open, dispatch continues unsigned):",
      err instanceof Error ? err.message : err,
    );
    return null;
  }
}

let cachedPublicKey: KeyObject | null = null;
let cachedPublicKeyId: string | null = null;

async function loadPublicKey(
  kms: Pick<KMSClient, "send">,
): Promise<KeyObject | null> {
  const key = keyId();
  if (!key) return null;
  if (cachedPublicKey && cachedPublicKeyId === key) return cachedPublicKey;
  const result = await kms.send(new GetPublicKeyCommand({ KeyId: key }));
  if (!result.PublicKey) return null;
  cachedPublicKey = createPublicKey({
    key: Buffer.from(result.PublicKey),
    format: "der",
    type: "spki",
  });
  cachedPublicKeyId = key;
  return cachedPublicKey;
}

export type TurnAssertionVerdict =
  | { status: "valid"; binding: TurnAssertionBinding }
  | { status: "invalid"; reason: string }
  | { status: "unavailable"; reason: string };

/**
 * Verify a turn assertion token. `unavailable` (no key configured / KMS
 * public-key fetch failed) is distinct from `invalid` so callers can keep
 * the C18 tolerant posture without treating verifier outages as forgeries.
 */
export async function verifyTurnAssertion(
  token: string,
  deps: { kms?: Pick<KMSClient, "send">; now?: Date } = {},
): Promise<TurnAssertionVerdict> {
  const parts = token.split(".");
  if (parts.length !== 3 || parts[0] !== TOKEN_PREFIX) {
    return { status: "invalid", reason: "malformed" };
  }
  let payloadBuf: Buffer;
  let sigBuf: Buffer;
  try {
    payloadBuf = Buffer.from(parts[1]!, "base64url");
    sigBuf = Buffer.from(parts[2]!, "base64url");
  } catch {
    return { status: "invalid", reason: "malformed" };
  }
  let publicKey: KeyObject | null;
  try {
    publicKey = await loadPublicKey(deps.kms ?? getKms());
  } catch (err) {
    return {
      status: "unavailable",
      reason: err instanceof Error ? err.message : String(err),
    };
  }
  if (!publicKey) {
    return { status: "unavailable", reason: "no key configured" };
  }
  let ok = false;
  try {
    ok = cryptoVerify("sha256", payloadBuf, publicKey, sigBuf);
  } catch {
    ok = false;
  }
  if (!ok) return { status: "invalid", reason: "bad signature" };

  let payload: TurnAssertionPayload;
  try {
    payload = JSON.parse(payloadBuf.toString("utf8")) as TurnAssertionPayload;
  } catch {
    return { status: "invalid", reason: "bad payload json" };
  }
  if (
    typeof payload.tenant_id !== "string" ||
    typeof payload.thread_id !== "string" ||
    typeof payload.turn_id !== "string" ||
    typeof payload.exp !== "number"
  ) {
    return { status: "invalid", reason: "bad payload shape" };
  }
  const nowSec = Math.floor((deps.now ?? new Date()).getTime() / 1000);
  if (nowSec > payload.exp) return { status: "invalid", reason: "expired" };
  return {
    status: "valid",
    binding: {
      tenant_id: payload.tenant_id,
      thread_id: payload.thread_id,
      turn_id: payload.turn_id,
    },
  };
}

/**
 * Handler-side enforcement wrapper (THINK-324 C19). Reads the assertion
 * header, verifies it, and checks the binding against the write target.
 *
 * Outcomes:
 *  - `{ ok: true }`  — valid+matching, or tolerated absence/outage.
 *  - `{ ok: false, reason }` — invalid signature, binding mismatch, or
 *    (when `required` is set) a missing assertion. Callers respond 401.
 *
 * `required` comes from TURN_ASSERTION_REQUIRED=true on the handler env —
 * flip it per surface once every producer of that surface echoes the
 * assertion. Verifier unavailability is tolerated even in required mode:
 * a KMS outage must degrade to bearer-only, never to a write outage.
 */
export async function enforceTurnAssertion(args: {
  headers: Record<string, string | undefined>;
  binding: TurnAssertionBinding;
  surface: string;
  required?: boolean;
}): Promise<{ ok: true } | { ok: false; reason: string }> {
  const required =
    args.required ?? process.env.TURN_ASSERTION_REQUIRED === "true";
  const token =
    args.headers[TURN_ASSERTION_HEADER] ??
    args.headers[TURN_ASSERTION_HEADER.toUpperCase()] ??
    null;
  if (!token) {
    if (required) {
      console.warn(
        `[${args.surface}] turn assertion missing (required): turn=${args.binding.turn_id}`,
      );
      return { ok: false, reason: "assertion required" };
    }
    console.info(
      `[${args.surface}] no turn assertion presented (tolerated): turn=${args.binding.turn_id}`,
    );
    return { ok: true };
  }
  const verdict = await verifyTurnAssertion(token);
  if (verdict.status === "invalid") {
    console.warn(
      `[${args.surface}] turn assertion rejected (${verdict.reason}): turn=${args.binding.turn_id}`,
    );
    return { ok: false, reason: verdict.reason };
  }
  if (verdict.status === "unavailable") {
    console.warn(
      `[${args.surface}] turn assertion verifier unavailable (${verdict.reason}); accepting bearer-only`,
    );
    return { ok: true };
  }
  const b = verdict.binding;
  if (
    b.tenant_id !== args.binding.tenant_id ||
    b.thread_id !== args.binding.thread_id ||
    b.turn_id !== args.binding.turn_id
  ) {
    console.warn(
      `[${args.surface}] turn assertion binding mismatch: asserted turn=${b.turn_id} target turn=${args.binding.turn_id}`,
    );
    return { ok: false, reason: "binding mismatch" };
  }
  return { ok: true };
}
