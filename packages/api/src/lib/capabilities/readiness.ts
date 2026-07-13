/**
 * Per-binding credential readiness (THINK-280 U2 — R6, R7; AE2).
 *
 * State machine: pending_setup → verifying → ready | degraded, plus a
 * terminal, idempotent revoked. Readiness is a property of ONE binding
 * (definition version × explicit principal); verification never promotes
 * or demotes the definition/version lifecycle, and action-time principal
 * resolution never falls back across modes (R6) — that pairing is
 * enforced structurally at creation.
 *
 * Secret custody: bindings store vault REFERENCES only (mirroring the
 * ALLOWED_REF_RE discipline in definition-schemas.ts). Verification
 * resolves only the binding's declared refs through an injected
 * `secretResolver` inside the trusted API path, runs the injected
 * `probeRunner`, and persists evidence stripped to an exact allowlist —
 * credential values and probe response bodies can never reach
 * readiness_evidence_json.
 *
 * No real probe ships in this slice: `readOnlyHttpProbeRunner` is a stub
 * that throws, so nothing can accidentally dispatch (the service wiring
 * slice supplies the real read-only HTTP probe).
 */

import { eq } from "drizzle-orm";
import {
  capabilityCredentialBindings,
  capabilityDefinitionVersions,
  tenantServicePrincipals,
} from "@thinkwork/database-pg/schema";
import type { Db } from "./research.js";

export type CapabilityCredentialBindingRow =
  typeof capabilityCredentialBindings.$inferSelect;

export const BINDING_PRINCIPAL_MODES = [
  "requester",
  "agent_owner",
  "service",
] as const;
export type BindingPrincipalMode = (typeof BINDING_PRINCIPAL_MODES)[number];

/**
 * Vault-reference shapes accepted in credential_refs_json values —
 * mirrors ALLOWED_REF_RE in definition-schemas.ts plus the
 * tenant_credentials row-id form the GraphQL contract documents
 * (`{ [credentialKind]: tenantCredentialId }`). Anything else is treated
 * as a possible raw secret and rejected.
 */
const VAULT_REF_RE =
  /^(?:secretsmanager:|ssm:|ref:|tenant-credential:|arn:aws:secretsmanager:|arn:aws:ssm:|[A-Z][A-Z0-9_]*$|[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$)/;

/** Injected interface over tenant-credentials/secret-store readTenantCredentialSecret. */
export interface BindingSecretResolver {
  resolve(ref: string): Promise<Record<string, unknown>>;
}

export interface ProbeOutcome {
  ok: boolean;
  statusCode?: number;
  durationMs?: number;
  failureKind?: string;
  /** Runners may return more (bodies, echoes) — it is stripped, never stored. */
  [key: string]: unknown;
}

export interface BindingProbeRunner {
  probe(input: {
    /** The signed descriptor of the binding's definition version. */
    descriptor: unknown;
    /** Operationless probe config — the declared cheap read-only check. */
    probeConfig: { readOnly: true };
    /** Resolved credential payloads keyed by credentialKind. */
    credential: Record<string, Record<string, unknown>>;
  }): Promise<ProbeOutcome>;
}

/**
 * Deliberate stub (U2a ships no execution path): the service wiring
 * slice supplies the real read-only HTTP probe implementation.
 */
export const readOnlyHttpProbeRunner: BindingProbeRunner = {
  async probe(): Promise<ProbeOutcome> {
    throw new Error("not-implemented-in-U2a");
  },
};

/** Exact allowlist persisted to readiness_evidence_json — nothing else. */
export interface RedactedReadinessEvidence {
  probedAt: string;
  statusCode?: number;
  durationMs?: number;
  failureKind?: string;
}

export interface CredentialBindingMutationResult {
  outcome: "applied" | "rejected" | "noop";
  reason?: string;
  binding?: CapabilityCredentialBindingRow;
}

export interface CreateCredentialBindingInput {
  tenantId: string;
  definitionVersionId: string;
  principalMode: string;
  servicePrincipalId?: string | null;
  subjectUserId?: string | null;
  /** { [credentialKind]: vaultRef } — references only, never raw secrets. */
  credentialRefs: unknown;
  createdByUserId?: string | null;
}

/**
 * Create a binding in 'pending_setup'. Validates the principal-mode /
 * subject pairing exactly as the DB CHECK does and rejects raw-secret-
 * looking credential values fail-closed.
 */
export async function createCredentialBinding(
  db: Db,
  input: CreateCredentialBindingInput,
): Promise<CredentialBindingMutationResult> {
  const reasons: string[] = [];

  const principalMode = input.principalMode as BindingPrincipalMode;
  if (!BINDING_PRINCIPAL_MODES.includes(principalMode)) {
    reasons.push(
      `principalMode: must be one of [${BINDING_PRINCIPAL_MODES.join(", ")}]`,
    );
  } else if (principalMode === "service") {
    if (!input.servicePrincipalId) {
      reasons.push("servicePrincipalId: required for service mode");
    }
    if (input.subjectUserId) {
      reasons.push("subjectUserId: must be null for service mode");
    }
  } else if (input.servicePrincipalId) {
    reasons.push(`servicePrincipalId: must be null for ${principalMode} mode`);
  }

  const credentialRefs = validateCredentialRefs(input.credentialRefs, reasons);

  if (reasons.length > 0) {
    return { outcome: "rejected", reason: reasons.join("; ") };
  }

  const [version] = await db
    .select()
    .from(capabilityDefinitionVersions)
    .where(eq(capabilityDefinitionVersions.id, input.definitionVersionId))
    .limit(1);
  if (!version) {
    return { outcome: "rejected", reason: "definition_version_not_found" };
  }

  if (principalMode === "service") {
    const [principal] = await db
      .select()
      .from(tenantServicePrincipals)
      .where(eq(tenantServicePrincipals.id, input.servicePrincipalId!))
      .limit(1);
    if (!principal || principal.tenant_id !== input.tenantId) {
      return { outcome: "rejected", reason: "service_principal_not_found" };
    }
    if (principal.status !== "active") {
      return { outcome: "rejected", reason: "service_principal_revoked" };
    }
  }

  const [binding] = await db
    .insert(capabilityCredentialBindings)
    .values({
      tenant_id: input.tenantId,
      definition_version_id: input.definitionVersionId,
      principal_mode: principalMode,
      service_principal_id:
        principalMode === "service" ? input.servicePrincipalId! : null,
      subject_user_id:
        principalMode === "service" ? null : (input.subjectUserId ?? null),
      credential_refs_json: credentialRefs!,
      readiness: "pending_setup",
      readiness_evidence_json: {},
      created_by_user_id: input.createdByUserId ?? null,
    })
    .returning();

  return { outcome: "applied", binding: binding! };
}

export interface VerifyCredentialBindingInput {
  tenantId: string;
  bindingId: string;
  secretResolver: BindingSecretResolver;
  probeRunner: BindingProbeRunner;
}

/**
 * Run the declared cheap read-only probe for ONE binding:
 * verifying → ready (probe ok) | degraded (resolution/probe failure).
 * Stored evidence is stripped to the exact allowlist
 * { probedAt, statusCode, durationMs, failureKind } — never credential
 * values, never probe bodies. Never touches the definition/version
 * lifecycle.
 */
export async function verifyCredentialBinding(
  db: Db,
  input: VerifyCredentialBindingInput,
): Promise<CredentialBindingMutationResult> {
  const [binding] = await db
    .select()
    .from(capabilityCredentialBindings)
    .where(eq(capabilityCredentialBindings.id, input.bindingId))
    .limit(1);
  if (!binding || binding.tenant_id !== input.tenantId) {
    return { outcome: "rejected", reason: "binding_not_found" };
  }
  if (binding.readiness === "revoked") {
    return { outcome: "rejected", reason: "binding_revoked" };
  }

  const [version] = await db
    .select()
    .from(capabilityDefinitionVersions)
    .where(eq(capabilityDefinitionVersions.id, binding.definition_version_id))
    .limit(1);
  if (!version) {
    return { outcome: "rejected", reason: "definition_version_not_found" };
  }

  await db
    .update(capabilityCredentialBindings)
    .set({ readiness: "verifying", updated_at: new Date() })
    .where(eq(capabilityCredentialBindings.id, binding.id));

  const probedAt = new Date().toISOString();

  // Resolve ONLY the binding's declared refs, inside the trusted path.
  const refs =
    binding.credential_refs_json &&
    typeof binding.credential_refs_json === "object" &&
    !Array.isArray(binding.credential_refs_json)
      ? (binding.credential_refs_json as Record<string, unknown>)
      : {};
  const credential: Record<string, Record<string, unknown>> = {};
  for (const [kind, ref] of Object.entries(refs)) {
    if (typeof ref !== "string") {
      return settleVerification(db, binding.id, false, {
        probedAt,
        failureKind: "credential_ref_invalid",
      });
    }
    try {
      credential[kind] = await input.secretResolver.resolve(ref);
    } catch {
      return settleVerification(db, binding.id, false, {
        probedAt,
        failureKind: "credential_resolution_failed",
      });
    }
  }

  let probe: ProbeOutcome;
  try {
    probe = await input.probeRunner.probe({
      descriptor: version.descriptor_json,
      probeConfig: { readOnly: true },
      credential,
    });
  } catch {
    return settleVerification(db, binding.id, false, {
      probedAt,
      failureKind: "probe_error",
    });
  }

  return settleVerification(
    db,
    binding.id,
    probe.ok === true,
    redactProbeEvidence(probe, probedAt),
  );
}

export interface RevokeCredentialBindingInput {
  tenantId: string;
  bindingId: string;
}

/** Revoke a binding (terminal). Idempotent — a second call is a noop. */
export async function revokeCredentialBinding(
  db: Db,
  input: RevokeCredentialBindingInput,
): Promise<CredentialBindingMutationResult> {
  const [binding] = await db
    .select()
    .from(capabilityCredentialBindings)
    .where(eq(capabilityCredentialBindings.id, input.bindingId))
    .limit(1);
  if (!binding || binding.tenant_id !== input.tenantId) {
    return { outcome: "rejected", reason: "binding_not_found" };
  }
  if (binding.readiness === "revoked") {
    return { outcome: "noop", binding };
  }
  const now = new Date();
  const [revoked] = await db
    .update(capabilityCredentialBindings)
    .set({ readiness: "revoked", revoked_at: now, updated_at: now })
    .where(eq(capabilityCredentialBindings.id, binding.id))
    .returning();
  return { outcome: "applied", binding: revoked ?? binding };
}

// ---------------------------------------------------------------------------
// helpers
// ---------------------------------------------------------------------------

function validateCredentialRefs(
  raw: unknown,
  reasons: string[],
): Record<string, string> | null {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    reasons.push("credentialRefs: must be a JSON object");
    return null;
  }
  const out: Record<string, string> = {};
  for (const [kind, value] of Object.entries(raw as Record<string, unknown>)) {
    if (kind.trim() === "") {
      reasons.push("credentialRefs: empty credential kind");
      continue;
    }
    if (typeof value !== "string" || value === "") {
      reasons.push(`credentialRefs.${kind}: must be a non-empty string`);
      continue;
    }
    if (!VAULT_REF_RE.test(value)) {
      // The offending VALUE is deliberately not echoed — it may be a secret.
      reasons.push(
        `credentialRefs.${kind}: must be a vault reference ` +
          "(secretsmanager:/ssm:/ref:/tenant-credential:/arn/tenant credential id), " +
          "raw secret values are rejected",
      );
    } else {
      out[kind] = value;
    }
  }
  return reasons.length > 0 ? null : out;
}

/**
 * Strip probe output to the exact stored-evidence allowlist. Built fresh
 * from primitives so extra runner fields (bodies, credential echoes) can
 * never reach the row.
 */
function redactProbeEvidence(
  probe: ProbeOutcome,
  probedAt: string,
): RedactedReadinessEvidence {
  const evidence: RedactedReadinessEvidence = { probedAt };
  if (
    typeof probe.statusCode === "number" &&
    Number.isFinite(probe.statusCode)
  ) {
    evidence.statusCode = probe.statusCode;
  }
  if (
    typeof probe.durationMs === "number" &&
    Number.isFinite(probe.durationMs)
  ) {
    evidence.durationMs = probe.durationMs;
  }
  if (!probe.ok) {
    evidence.failureKind =
      typeof probe.failureKind === "string" && probe.failureKind !== ""
        ? probe.failureKind.slice(0, 200)
        : "probe_failed";
  }
  return evidence;
}

async function settleVerification(
  db: Db,
  bindingId: string,
  ok: boolean,
  evidence: RedactedReadinessEvidence,
): Promise<CredentialBindingMutationResult> {
  const now = new Date();
  const [updated] = await db
    .update(capabilityCredentialBindings)
    .set({
      readiness: ok ? "ready" : "degraded",
      readiness_evidence_json: evidence,
      ...(ok ? { last_verified_at: now } : {}),
      updated_at: now,
    })
    .where(eq(capabilityCredentialBindings.id, bindingId))
    .returning();
  return {
    outcome: "applied",
    ...(ok ? {} : { reason: evidence.failureKind }),
    binding: updated!,
  };
}
