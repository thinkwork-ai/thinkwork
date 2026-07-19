/**
 * Validate and record the machine-readable native-auth cutover evidence that
 * gates migration 0263. Dry-run is the default; --apply marks the matching
 * inventory complete only when every zero/boolean predicate is exact.
 */

import {
  createHash,
  createPrivateKey,
  createPublicKey,
  sign as edSign,
  verify as edVerify,
  type KeyObject,
} from "node:crypto";
import { readFileSync } from "node:fs";
import { pathToFileURL } from "node:url";
import { and, eq } from "drizzle-orm";
import { authCutoverRuns } from "@thinkwork/database-pg/schema";
import { getSecret } from "@thinkwork/runtime-config";
import { db } from "../src/lib/db.js";

const SHA256_RE = /^[a-f0-9]{64}$/;
const REVISION_RE = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MAX_EVIDENCE_LIFETIME_MS = 15 * 60 * 1000;
const MAX_CLOCK_SKEW_MS = 5 * 60 * 1000;

// The retired clients issue one-hour ID/access tokens. AppSync GraphQL
// WebSocket connections can remain open for 24 hours, so realtime drain is the
// dominant safety bound once legacy clients and start routes are disabled.
export const AUTH_CUTOVER_MAX_LEGACY_TOKEN_LIFETIME_SECONDS = 60 * 60;
export const AUTH_CUTOVER_MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS =
  24 * 60 * 60;
export const AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS = Math.max(
  AUTH_CUTOVER_MAX_LEGACY_TOKEN_LIFETIME_SECONDS,
  AUTH_CUTOVER_MAX_APPSYNC_CONNECTION_LIFETIME_SECONDS,
);

export const AUTH_CUTOVER_EVIDENCE_DOMAIN =
  "thinkwork.auth-cutover-evidence.v1";
export const AUTH_CUTOVER_EVIDENCE_SOURCE = "verify-native-auth-cutover";

export interface AuthCutoverCompletionEvidence {
  schemaVersion: 1;
  domain: typeof AUTH_CUTOVER_EVIDENCE_DOMAIN;
  source: typeof AUTH_CUTOVER_EVIDENCE_SOURCE;
  stage: string;
  runId: string;
  deploymentRevision: string;
  observedAt: string;
  expiresAt: string;
  inventoryFingerprint: string;
  terminalDispositions: {
    allTerminal: true;
    unresolved: 0;
    signoutExpected: number;
    signoutAttempts: number;
    signoutFailures: 0;
    compatibilityFallbackReads: 0;
  };
  clientShutdownEvidence: {
    workosStartsEnabled: false;
    legacyClientsEnabled: 0;
    legacyAudiencesAccepted: 0;
  };
  drainEvidence: {
    drainCompleted: true;
    legacyRouteTraffic: 0;
    workosTableReads: 0;
    workosTableWrites: 0;
    activeLegacySubscriptions: 0;
    databaseStatsResetAt: string;
  };
}

export interface AuthCutoverEvidenceEnvelope {
  payload: AuthCutoverCompletionEvidence;
  attestation: {
    version: 1;
    algorithm: "Ed25519";
    keyId: string;
    payloadHash: string;
    signature: string;
  };
}

export interface AuthCutoverSoakEvidence {
  guardEnabled: true;
  soakStartedAt: string;
  requiredSoakSeconds: number;
  deploymentRevision: string;
  baselineWorkosTableReads: number;
  baselineWorkosTableWrites: number;
  baselineDatabaseStatsResetAt: string;
}

function record(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new Error(`${path} must be an object`);
  }
  return value as Record<string, unknown>;
}

function exactKeys(
  value: Record<string, unknown>,
  expected: string[],
  path: string,
): void {
  const actual = Object.keys(value).sort();
  if (JSON.stringify(actual) !== JSON.stringify([...expected].sort())) {
    throw new Error(`${path} must contain exactly: ${expected.join(", ")}`);
  }
}

export function parseAuthCutoverCompletionEvidence(
  input: unknown,
): AuthCutoverCompletionEvidence {
  const root = record(input, "evidence");
  exactKeys(
    root,
    [
      "schemaVersion",
      "domain",
      "source",
      "stage",
      "runId",
      "deploymentRevision",
      "observedAt",
      "expiresAt",
      "inventoryFingerprint",
      "terminalDispositions",
      "clientShutdownEvidence",
      "drainEvidence",
    ],
    "evidence",
  );
  if (root.schemaVersion !== 1) {
    throw new Error("evidence.schemaVersion must equal 1");
  }
  if (root.domain !== AUTH_CUTOVER_EVIDENCE_DOMAIN) {
    throw new Error(
      `evidence.domain must equal ${AUTH_CUTOVER_EVIDENCE_DOMAIN}`,
    );
  }
  if (root.source !== AUTH_CUTOVER_EVIDENCE_SOURCE) {
    throw new Error(
      `evidence.source must equal ${AUTH_CUTOVER_EVIDENCE_SOURCE}`,
    );
  }
  if (
    typeof root.stage !== "string" ||
    !/^[a-z0-9][a-z0-9-]{0,62}$/.test(root.stage)
  ) {
    throw new Error("evidence.stage is invalid");
  }
  if (typeof root.runId !== "string" || !UUID_RE.test(root.runId)) {
    throw new Error("evidence.runId must be a UUID");
  }
  if (
    typeof root.deploymentRevision !== "string" ||
    !REVISION_RE.test(root.deploymentRevision)
  ) {
    throw new Error("evidence.deploymentRevision must be a Git revision");
  }
  const observedAt = parseIsoDate(root.observedAt, "evidence.observedAt");
  const expiresAt = parseIsoDate(root.expiresAt, "evidence.expiresAt");
  if (expiresAt <= observedAt) {
    throw new Error("evidence.expiresAt must be after evidence.observedAt");
  }
  if (
    typeof root.inventoryFingerprint !== "string" ||
    !SHA256_RE.test(root.inventoryFingerprint)
  ) {
    throw new Error("evidence.inventoryFingerprint must be a SHA-256 digest");
  }
  const terminal = record(
    root.terminalDispositions,
    "evidence.terminalDispositions",
  );
  exactKeys(
    terminal,
    [
      "allTerminal",
      "unresolved",
      "signoutExpected",
      "signoutAttempts",
      "signoutFailures",
      "compatibilityFallbackReads",
    ],
    "evidence.terminalDispositions",
  );
  if (
    !Number.isInteger(terminal.signoutExpected) ||
    (terminal.signoutExpected as number) <= 0
  ) {
    throw new Error(
      "terminalDispositions.signoutExpected must be a positive integer",
    );
  }
  if (
    !Number.isInteger(terminal.signoutAttempts) ||
    terminal.signoutAttempts !== terminal.signoutExpected
  ) {
    throw new Error(
      "terminalDispositions.signoutAttempts must equal signoutExpected",
    );
  }
  const clients = record(
    root.clientShutdownEvidence,
    "evidence.clientShutdownEvidence",
  );
  exactKeys(
    clients,
    ["workosStartsEnabled", "legacyClientsEnabled", "legacyAudiencesAccepted"],
    "evidence.clientShutdownEvidence",
  );
  const drain = record(root.drainEvidence, "evidence.drainEvidence");
  exactKeys(
    drain,
    [
      "drainCompleted",
      "legacyRouteTraffic",
      "workosTableReads",
      "workosTableWrites",
      "activeLegacySubscriptions",
      "databaseStatsResetAt",
    ],
    "evidence.drainEvidence",
  );
  const predicates: Array<[unknown, unknown, string]> = [
    [terminal.allTerminal, true, "terminalDispositions.allTerminal"],
    [terminal.unresolved, 0, "terminalDispositions.unresolved"],
    [terminal.signoutFailures, 0, "terminalDispositions.signoutFailures"],
    [
      terminal.compatibilityFallbackReads,
      0,
      "terminalDispositions.compatibilityFallbackReads",
    ],
    [
      clients.workosStartsEnabled,
      false,
      "clientShutdownEvidence.workosStartsEnabled",
    ],
    [
      clients.legacyClientsEnabled,
      0,
      "clientShutdownEvidence.legacyClientsEnabled",
    ],
    [
      clients.legacyAudiencesAccepted,
      0,
      "clientShutdownEvidence.legacyAudiencesAccepted",
    ],
    [drain.drainCompleted, true, "drainEvidence.drainCompleted"],
    [drain.legacyRouteTraffic, 0, "drainEvidence.legacyRouteTraffic"],
    [drain.workosTableReads, 0, "drainEvidence.workosTableReads"],
    [drain.workosTableWrites, 0, "drainEvidence.workosTableWrites"],
    [
      drain.activeLegacySubscriptions,
      0,
      "drainEvidence.activeLegacySubscriptions",
    ],
  ];
  for (const [actual, expected, path] of predicates) {
    if (actual !== expected) {
      throw new Error(`${path} must equal ${String(expected)}`);
    }
  }
  parseIsoDate(
    drain.databaseStatsResetAt,
    "evidence.drainEvidence.databaseStatsResetAt",
  );
  return input as AuthCutoverCompletionEvidence;
}

export function attestAuthCutoverCompletionEvidence(
  input: unknown,
  options: { keyId: string; privateKey: string | KeyObject },
): AuthCutoverEvidenceEnvelope {
  const payload = parseAuthCutoverCompletionEvidence(input);
  if (!options.keyId.trim()) {
    throw new Error("auth cutover evidence key ID is required");
  }
  const canonical = canonicalize(payload);
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  const privateKey =
    typeof options.privateKey === "string"
      ? createPrivateKey(normalizePem(options.privateKey))
      : options.privateKey;
  return {
    payload,
    attestation: {
      version: 1,
      algorithm: "Ed25519",
      keyId: options.keyId,
      payloadHash,
      signature: edSign(
        null,
        Buffer.from(canonical, "utf8"),
        privateKey,
      ).toString("base64url"),
    },
  };
}

export function verifyAuthCutoverCompletionEvidence(
  input: unknown,
  options: {
    expectedKeyId: string;
    publicKey: string | KeyObject;
    stage: string;
    deploymentRevision: string;
    nowMs?: () => number;
  },
): AuthCutoverCompletionEvidence {
  const envelope = record(input, "evidence envelope");
  exactKeys(envelope, ["payload", "attestation"], "evidence envelope");
  const attestation = record(
    envelope.attestation,
    "evidence envelope.attestation",
  );
  exactKeys(
    attestation,
    ["version", "algorithm", "keyId", "payloadHash", "signature"],
    "evidence envelope.attestation",
  );
  if (
    attestation.version !== 1 ||
    attestation.algorithm !== "Ed25519" ||
    attestation.keyId !== options.expectedKeyId ||
    typeof attestation.payloadHash !== "string" ||
    !SHA256_RE.test(attestation.payloadHash) ||
    typeof attestation.signature !== "string" ||
    !attestation.signature
  ) {
    throw new Error("auth cutover evidence attestation is invalid");
  }
  const canonical = canonicalize(envelope.payload);
  const payloadHash = createHash("sha256").update(canonical).digest("hex");
  const publicKey =
    typeof options.publicKey === "string"
      ? createPublicKey(normalizePem(options.publicKey))
      : options.publicKey;
  if (
    payloadHash !== attestation.payloadHash ||
    !edVerify(
      null,
      Buffer.from(canonical, "utf8"),
      publicKey,
      Buffer.from(attestation.signature, "base64url"),
    )
  ) {
    throw new Error("auth cutover evidence signature is invalid");
  }
  const payload = parseAuthCutoverCompletionEvidence(envelope.payload);
  if (payload.stage !== options.stage) {
    throw new Error("auth cutover evidence stage does not match deployment");
  }
  if (payload.deploymentRevision !== options.deploymentRevision) {
    throw new Error("auth cutover evidence revision does not match deployment");
  }
  const now = (options.nowMs ?? Date.now)();
  const observedAt = Date.parse(payload.observedAt);
  const expiresAt = Date.parse(payload.expiresAt);
  if (observedAt > now + MAX_CLOCK_SKEW_MS) {
    throw new Error("auth cutover evidence observation is in the future");
  }
  if (expiresAt <= now) {
    throw new Error("auth cutover evidence has expired");
  }
  if (expiresAt - observedAt > MAX_EVIDENCE_LIFETIME_MS) {
    throw new Error("auth cutover evidence validity window is too long");
  }
  return payload;
}

function parseIsoDate(value: unknown, path: string): number {
  if (typeof value !== "string") throw new Error(`${path} must be an ISO date`);
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed) || new Date(parsed).toISOString() !== value) {
    throw new Error(`${path} must be an ISO date`);
  }
  return parsed;
}

function canonicalize(value: unknown): string {
  return JSON.stringify(sortValue(value));
}

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortValue);
  if (value && typeof value === "object") {
    const result: Record<string, unknown> = {};
    const source = value as Record<string, unknown>;
    for (const key of Object.keys(source).sort()) {
      if (source[key] !== undefined) result[key] = sortValue(source[key]);
    }
    return result;
  }
  return value;
}

function normalizePem(value: string): string {
  return value.includes("\\n") ? value.replace(/\\n/g, "\n") : value;
}

export function mergeObservedCutoverEvidence(
  observed: Record<string, unknown>,
  completion: AuthCutoverCompletionEvidence["terminalDispositions"],
): Record<string, unknown> {
  if (observed.workosDirectoryComplete !== true) {
    throw new Error(
      "stored inventory is not a complete WorkOS directory snapshot",
    );
  }
  if (
    typeof observed.workosUnresolved !== "number" ||
    observed.workosUnresolved !== 0
  ) {
    throw new Error("stored inventory still has unresolved WorkOS identities");
  }
  for (const field of ["findings", "workosFindings"]) {
    if (!Array.isArray(observed[field])) {
      throw new Error(`stored inventory is missing the observed ${field}`);
    }
    if (observed[field].length !== 0) {
      throw new Error(`stored inventory still has ${field}`);
    }
  }
  for (const field of [
    "active",
    "quarantined",
    "workosMapped",
    "workosQuarantined",
  ]) {
    if (typeof observed[field] !== "number" || Number(observed[field]) < 0) {
      throw new Error(
        `stored inventory is missing the observed ${field} count`,
      );
    }
  }
  const unresolved =
    observed.workosUnresolved +
    (observed.findings as unknown[]).length +
    (observed.workosFindings as unknown[]).length;
  return { ...observed, ...completion, unresolved };
}

export function validateStoredCutoverSoak(
  input: unknown,
  completion: AuthCutoverCompletionEvidence,
): AuthCutoverSoakEvidence {
  const soak = record(input, "stored cutover soak evidence");
  if (soak.guardEnabled !== true) {
    throw new Error("stored cutover soak guard is not enabled");
  }
  const soakStartedAt = parseIsoDate(
    soak.soakStartedAt,
    "stored cutover soak evidence.soakStartedAt",
  );
  if (
    typeof soak.requiredSoakSeconds !== "number" ||
    !Number.isSafeInteger(soak.requiredSoakSeconds) ||
    soak.requiredSoakSeconds < AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS
  ) {
    throw new Error(
      `stored cutover soak duration must meet the ${AUTH_CUTOVER_MIN_SAFE_SOAK_SECONDS}-second safe minimum`,
    );
  }
  if (soak.deploymentRevision !== completion.deploymentRevision) {
    throw new Error("stored cutover soak revision does not match deployment");
  }
  if (
    Date.parse(completion.observedAt) <
    soakStartedAt + soak.requiredSoakSeconds * 1000
  ) {
    throw new Error("required cutover soak duration has not elapsed");
  }
  for (const field of [
    "baselineWorkosTableReads",
    "baselineWorkosTableWrites",
  ] as const) {
    if (
      typeof soak[field] !== "number" ||
      !Number.isSafeInteger(soak[field]) ||
      soak[field] < 0
    ) {
      throw new Error(`stored cutover soak ${field} is invalid`);
    }
  }
  parseIsoDate(
    soak.baselineDatabaseStatsResetAt,
    "stored cutover soak evidence.baselineDatabaseStatsResetAt",
  );
  if (
    soak.baselineDatabaseStatsResetAt !==
    completion.drainEvidence.databaseStatsResetAt
  ) {
    throw new Error(
      "PostgreSQL statistics reset epoch changed during the cutover soak",
    );
  }
  return input as AuthCutoverSoakEvidence;
}

function option(name: string): string | null {
  const index = process.argv.indexOf(name);
  return index >= 0 ? (process.argv[index + 1] ?? null) : null;
}

async function main(): Promise<void> {
  const evidencePath = option("--evidence");
  const stage = process.env.THINKWORK_STAGE;
  if (!evidencePath || !stage) {
    throw new Error("--evidence <path> and THINKWORK_STAGE are required");
  }
  const input = JSON.parse(readFileSync(evidencePath, "utf8")) as unknown;
  const keyId =
    process.env.AUTH_CUTOVER_EVIDENCE_KEY_ID ?? `${stage}-auth-cutover-v1`;
  const keyPair = await resolveCutoverEvidenceKeys(stage);
  if (process.argv.includes("--attest")) {
    const envelope = attestAuthCutoverCompletionEvidence(input, {
      keyId,
      privateKey: keyPair.privateKey,
    });
    process.stdout.write(`${JSON.stringify(envelope)}\n`);
    return;
  }
  const deploymentRevision =
    process.env.THINKWORK_RELEASE_GIT_SHA ?? process.env.GITHUB_SHA;
  if (!deploymentRevision || !REVISION_RE.test(deploymentRevision)) {
    throw new Error(
      "THINKWORK_RELEASE_GIT_SHA or GITHUB_SHA must identify the deployed revision",
    );
  }
  const evidence = verifyAuthCutoverCompletionEvidence(input, {
    expectedKeyId: keyId,
    publicKey: keyPair.publicKey,
    stage,
    deploymentRevision,
  });
  const attestation = (input as AuthCutoverEvidenceEnvelope).attestation;
  const apply = process.argv.includes("--apply");
  if (apply) {
    await db.transaction(async (tx) => {
      const rows = await tx
        .select({
          id: authCutoverRuns.id,
          status: authCutoverRuns.status,
          terminalDispositions: authCutoverRuns.terminal_dispositions,
          drainEvidence: authCutoverRuns.drain_evidence,
          startedAt: authCutoverRuns.started_at,
        })
        .from(authCutoverRuns)
        .where(
          and(
            eq(authCutoverRuns.stage, stage),
            eq(
              authCutoverRuns.inventory_fingerprint,
              evidence.inventoryFingerprint,
            ),
          ),
        )
        .for("update");
      if (rows.length !== 1) {
        throw new Error(
          "exactly one matching auth cutover inventory is required",
        );
      }
      if (rows[0]!.id !== evidence.runId) {
        throw new Error("signed evidence run does not match stored inventory");
      }
      if (rows[0]!.status !== "soaking") {
        throw new Error(
          `auth cutover inventory cannot complete from ${rows[0]!.status}`,
        );
      }
      if (Date.parse(evidence.observedAt) < rows[0]!.startedAt.getTime()) {
        throw new Error("signed evidence predates the stored cutover run");
      }
      const soakEvidence = validateStoredCutoverSoak(
        rows[0]!.drainEvidence,
        evidence,
      );
      const terminalDispositions = mergeObservedCutoverEvidence(
        rows[0]!.terminalDispositions,
        evidence.terminalDispositions,
      );
      await tx
        .update(authCutoverRuns)
        .set({
          status: "complete",
          terminal_dispositions: terminalDispositions,
          client_shutdown_evidence: evidence.clientShutdownEvidence,
          drain_evidence: {
            ...evidence.drainEvidence,
            ...soakEvidence,
            provenance: {
              domain: evidence.domain,
              source: evidence.source,
              stage: evidence.stage,
              runId: evidence.runId,
              deploymentRevision: evidence.deploymentRevision,
              observedAt: evidence.observedAt,
              expiresAt: evidence.expiresAt,
              keyId: attestation.keyId,
              payloadHash: attestation.payloadHash,
              signature: attestation.signature,
            },
          },
          completed_at: new Date(),
        })
        .where(eq(authCutoverRuns.id, rows[0]!.id));
    });
  }
  process.stdout.write(
    `${JSON.stringify({
      mode: apply ? "apply" : "dry-run",
      stage,
      inventoryFingerprint: evidence.inventoryFingerprint,
      gates: "complete",
    })}\n`,
  );
}

async function resolveCutoverEvidenceKeys(stage: string): Promise<{
  privateKey: KeyObject;
  publicKey: KeyObject;
}> {
  const direct = process.env.AUTH_CUTOVER_EVIDENCE_PRIVATE_KEY;
  const secretName =
    process.env.AUTH_CUTOVER_EVIDENCE_PRIVATE_KEY_SECRET ??
    process.env.CAPABILITY_SIGNING_PRIVATE_KEY_SECRET ??
    `thinkwork/${stage}/capability-signing-key`;
  const pem = direct?.trim() ? direct : await getSecret(secretName);
  if (!pem?.trim()) {
    throw new Error("auth cutover evidence signing key is unavailable");
  }
  const privateKey = createPrivateKey(normalizePem(pem));
  return { privateKey, publicKey: createPublicKey(privateKey) };
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`Auth cutover finalization failed: ${message}\n`);
    process.exitCode = 1;
  });
}
