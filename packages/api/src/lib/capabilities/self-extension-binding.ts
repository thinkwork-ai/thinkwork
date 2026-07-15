/**
 * AUTO-tier runnability: auto-provision a service principal + empty-credential
 * binding for an autonomously self-admitted, public/no-credential capability
 * (governed autonomy U2b).
 *
 * A self-admitted public operation is admitted but NOT yet runnable: the broker
 * authorization loader rejects `no_ready_binding_for_principal` unless a
 * `ready` credential binding exists for the operation's principal. In the
 * THINK-280 dogfood this binding was hand-created by an operator; for autonomous
 * self-extension nobody is there to create it. This module closes that gap so
 * "admit" and "make runnable" are one atomic autonomous step.
 *
 * For a public, no-credential op the binding carries EMPTY `credential_refs`,
 * and the read-only HTTP reachability probe (`readOnlyHttpProbeRunner`) is the
 * whole readiness gate — no secret to resolve, just proof the target is
 * reachable and does not reject an unauthenticated read.
 *
 * Fail-closed: if the probe does not return `ready`, the binding is left
 * `degraded` and surfaced — the auto-run correctly blocks until it is ready,
 * exactly as any other not-ready binding would.
 */

import { and, eq } from "drizzle-orm";
import {
  capabilityCredentialBindings,
  tenantServicePrincipals,
} from "@thinkwork/database-pg/schema";
import type { Db } from "./research.js";
import {
  createCredentialBinding,
  verifyCredentialBinding,
  type BindingProbeRunner,
  type BindingSecretResolver,
  type CapabilityCredentialBindingRow,
} from "./readiness.js";

/** Deterministic per-tenant slug for an agent's self-extension service principal. */
export function selfExtensionServicePrincipalSlug(agentId: string): string {
  // agentId is a UUID (lowercase hex + dashes); `agent-<uuid>` is 42 chars,
  // well within the [a-z0-9-]{1,64} slug constraint.
  return `agent-${agentId}`;
}

export interface AutoProvisionBindingDeps {
  probeRunner: BindingProbeRunner;
  secretResolver: BindingSecretResolver;
}

export interface AutoProvisionServiceBindingInput {
  tenantId: string;
  /** The admitted capability definition version to make runnable. */
  definitionVersionId: string;
  /** The self-extending agent — owns the service principal. */
  agentId: string;
}

export interface AutoProvisionServiceBindingResult {
  /**
   * - `ready`: SP + binding provisioned and the probe confirmed reachability.
   * - `degraded`: SP + binding provisioned, but the probe did not confirm
   *   reachability — the binding exists but auto-run will block until ready.
   * - `rejected`: could not provision (e.g. the agent's SP is revoked, or the
   *   binding could not be created); nothing runnable was produced.
   */
  outcome: "ready" | "degraded" | "rejected";
  reason?: string;
  servicePrincipalId?: string;
  binding?: CapabilityCredentialBindingRow;
}

/**
 * Ensure the agent's tenant service principal exists (reusing it across every
 * capability the agent self-acquires), create an EMPTY-credential `service`
 * binding for the admitted version, and drive it to `ready` via the read-only
 * reachability probe. Fail-closed at every step.
 */
export async function autoProvisionServiceBinding(
  db: Db,
  input: AutoProvisionServiceBindingInput,
  deps: AutoProvisionBindingDeps,
): Promise<AutoProvisionServiceBindingResult> {
  const servicePrincipalId = await ensureAgentServicePrincipal(db, input);
  if (servicePrincipalId.outcome === "rejected") {
    return { outcome: "rejected", reason: servicePrincipalId.reason };
  }

  const created = await createCredentialBinding(db, {
    tenantId: input.tenantId,
    definitionVersionId: input.definitionVersionId,
    principalMode: "service",
    servicePrincipalId: servicePrincipalId.id,
    credentialRefs: {}, // public/no-credential op — no secrets to wire
    createdByUserId: null, // autonomous — no operator
  });
  if (created.outcome !== "applied" || !created.binding) {
    return {
      outcome: "rejected",
      reason: created.reason ?? "binding_create_failed",
      servicePrincipalId: servicePrincipalId.id,
    };
  }

  const verified = await verifyCredentialBinding(db, {
    tenantId: input.tenantId,
    bindingId: created.binding.id,
    secretResolver: deps.secretResolver,
    probeRunner: deps.probeRunner,
  });

  // The readiness lib absorbs probe failure into a `degraded` binding rather
  // than throwing, so `verified.binding` is the settled row either way.
  const settled = verified.binding ?? created.binding;
  if (settled.readiness === "ready") {
    return {
      outcome: "ready",
      servicePrincipalId: servicePrincipalId.id,
      binding: settled,
    };
  }
  return {
    outcome: "degraded",
    reason: verified.reason ?? `binding_${settled.readiness}`,
    servicePrincipalId: servicePrincipalId.id,
    binding: settled,
  };
}

interface EnsureServicePrincipalResult {
  outcome: "applied" | "rejected";
  id?: string;
  reason?: string;
}

/**
 * Idempotently resolve the agent's self-extension service principal. Reuses an
 * existing `active` principal; a `revoked` one is a hard, fail-closed stop (an
 * operator revoked this agent's non-human identity — do not resurrect it).
 */
async function ensureAgentServicePrincipal(
  db: Db,
  input: AutoProvisionServiceBindingInput,
): Promise<EnsureServicePrincipalResult> {
  const slug = selfExtensionServicePrincipalSlug(input.agentId);

  const [existing] = await db
    .select()
    .from(tenantServicePrincipals)
    .where(
      and(
        eq(tenantServicePrincipals.tenant_id, input.tenantId),
        eq(tenantServicePrincipals.slug, slug),
      ),
    )
    .limit(1);
  if (existing) {
    if (existing.status !== "active") {
      return { outcome: "rejected", reason: "service_principal_revoked" };
    }
    return { outcome: "applied", id: existing.id };
  }

  try {
    const [created] = await db
      .insert(tenantServicePrincipals)
      .values({
        tenant_id: input.tenantId,
        slug,
        display_name: `Agent ${input.agentId} (self-extension)`,
        purpose: "autonomous self-extension",
        status: "active",
        created_by_user_id: null, // autonomous — no operator
      })
      .returning();
    if (!created) {
      return { outcome: "rejected", reason: "service_principal_insert_failed" };
    }
    return { outcome: "applied", id: created.id };
  } catch {
    // Unique-index race on (tenant_id, slug) — re-read the winner.
    const [raced] = await db
      .select()
      .from(tenantServicePrincipals)
      .where(
        and(
          eq(tenantServicePrincipals.tenant_id, input.tenantId),
          eq(tenantServicePrincipals.slug, slug),
        ),
      )
      .limit(1);
    if (raced && raced.status === "active") {
      return { outcome: "applied", id: raced.id };
    }
    return { outcome: "rejected", reason: "service_principal_revoked" };
  }
}
