/**
 * createCredentialBinding / verifyCredentialBinding /
 * revokeCredentialBinding — per-binding credential readiness
 * (THINK-280 U2, R6/R7/AE2).
 *
 * Thin resolvers over lib/capabilities/readiness.ts. Secret custody:
 * bindings carry vault REFERENCES only (the lib rejects raw-secret-
 * looking values fail-closed), verification resolves refs through the
 * tenant-credentials secret store inside the trusted API path, and the
 * GraphQL projection (capabilityRuntime.shared.ts) structurally omits
 * `credential_refs_json`.
 *
 * No real probe ships in this slice: the injected runner is the
 * readiness stub that throws. That surfaces as outcome 'rejected' with
 * reason 'probe_unavailable' — never a crash, and never a fabricated
 * 'ready'.
 */

import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  createCredentialBinding as createCredentialBindingLib,
  readOnlyHttpProbeRunner,
  revokeCredentialBinding as revokeCredentialBindingLib,
  verifyCredentialBinding as verifyCredentialBindingLib,
  type BindingProbeRunner,
} from "../../../lib/capabilities/readiness.js";
import { readTenantCredentialSecret } from "../../../lib/tenant-credentials/secret-store.js";
import {
  bindingToGql,
  emitRuntimeAuditEvent,
  parseJsonish,
  resolveRuntimeActor,
} from "./capabilityRuntime.shared.js";

interface CreateCredentialBindingGqlInput {
  tenantId: string;
  definitionVersionId: string;
  principalMode: string;
  servicePrincipalId?: string | null;
  subjectUserId?: string | null;
  credentialRefs: unknown;
}

export async function createCredentialBinding(
  _parent: unknown,
  args: { input: CreateCredentialBindingGqlInput },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "capabilities:manage_credential_bindings",
  );
  const actor = await resolveRuntimeActor(ctx);

  const result = await createCredentialBindingLib(db, {
    tenantId: input.tenantId,
    definitionVersionId: input.definitionVersionId,
    principalMode: input.principalMode,
    servicePrincipalId: input.servicePrincipalId ?? null,
    subjectUserId: input.subjectUserId ?? null,
    credentialRefs: parseJsonish(input.credentialRefs),
    createdByUserId: actor.userId,
  });

  if (result.outcome === "applied" && result.binding) {
    await emitRuntimeAuditEvent({
      tenantId: input.tenantId,
      actor,
      eventType: "agent.credential_binding_created",
      resourceType: "capability_credential_binding",
      resourceId: result.binding.id,
      action: "create",
      payload: {
        bindingId: result.binding.id,
        definitionVersionId: result.binding.definition_version_id,
        principalMode: result.binding.principal_mode,
        servicePrincipalId: result.binding.service_principal_id ?? null,
        subjectUserId: result.binding.subject_user_id ?? null,
        readiness: result.binding.readiness,
      },
    });
  }

  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    binding: result.binding ? bindingToGql(result.binding) : null,
  };
}

export async function verifyCredentialBinding(
  _parent: unknown,
  args: { tenantId: string; bindingId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:manage_credential_bindings",
  );
  const actor = await resolveRuntimeActor(ctx);

  // The readiness lib deliberately absorbs probe throws into a degraded
  // binding; this wrapper detects the not-yet-implemented U2a stub so the
  // GraphQL outcome is an honest 'rejected: probe_unavailable' instead of
  // a degraded-looking verification result.
  let probeUnavailable = false;
  const probeRunner: BindingProbeRunner = {
    async probe(input) {
      try {
        return await readOnlyHttpProbeRunner.probe(input);
      } catch (err) {
        probeUnavailable = true;
        throw err;
      }
    },
  };

  const result = await verifyCredentialBindingLib(db, {
    tenantId: args.tenantId,
    bindingId: args.bindingId,
    secretResolver: {
      resolve: (ref) => readTenantCredentialSecret(ref),
    },
    probeRunner,
  });

  if (probeUnavailable) {
    return {
      outcome: "rejected",
      reason: "probe_unavailable",
      binding: result.binding ? bindingToGql(result.binding) : null,
    };
  }

  if (result.outcome === "applied" && result.binding) {
    await emitRuntimeAuditEvent({
      tenantId: args.tenantId,
      actor,
      eventType: "agent.credential_binding_verified",
      resourceType: "capability_credential_binding",
      resourceId: result.binding.id,
      action: "verify",
      payload: {
        bindingId: result.binding.id,
        definitionVersionId: result.binding.definition_version_id,
        readiness: result.binding.readiness,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
  }

  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    binding: result.binding ? bindingToGql(result.binding) : null,
  };
}

export async function revokeCredentialBinding(
  _parent: unknown,
  args: { tenantId: string; bindingId: string },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:manage_credential_bindings",
  );
  const actor = await resolveRuntimeActor(ctx);

  const result = await revokeCredentialBindingLib(db, {
    tenantId: args.tenantId,
    bindingId: args.bindingId,
  });

  if (result.outcome === "applied" && result.binding) {
    await emitRuntimeAuditEvent({
      tenantId: args.tenantId,
      actor,
      eventType: "agent.credential_binding_revoked",
      resourceType: "capability_credential_binding",
      resourceId: result.binding.id,
      action: "revoke",
      payload: {
        bindingId: result.binding.id,
        definitionVersionId: result.binding.definition_version_id,
        readiness: result.binding.readiness,
      },
    });
  }

  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    binding: result.binding ? bindingToGql(result.binding) : null,
  };
}
