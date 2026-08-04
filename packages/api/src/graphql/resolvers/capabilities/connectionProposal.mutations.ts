/**
 * createConnectionProposal / admitConnectionProposal /
 * rejectConnectionProposal — the research→admission write surface of the
 * governed capability runtime (THINK-280 U2, R3/R4/R5/AE3).
 *
 * The resolvers are thin: authz + AWSJSON tolerance + audit; the domain
 * semantics live in lib/capabilities/{research,admission}.ts. Admission
 * is the ONLY path that signs anything — signer resolution failing maps
 * to outcome 'rejected' reason 'signing_unavailable' (never an unsigned
 * write). The folder projection wires over putCapabilityFolder for the
 * tenant's platform default agent workspace; a projection failure is
 * 'projection_pending' on an APPLIED admission (the version row is
 * authoritative).
 *
 * Audit events follow the capabilityAssignment auditBase conventions —
 * emitted only for applied outcomes, in a dedicated transaction after
 * the write commits.
 */

import type { GraphQLContext } from "../../context.js";
import { agents, and, db, eq, tenants } from "../../utils.js";
import { capabilityConnectionProposals } from "@thinkwork/database-pg/schema";
import { requireAdminOrServiceCaller } from "../core/authz.js";
import {
  createConnectionProposal as createConnectionProposalLib,
  type CapabilityConnectionProposalRow,
} from "../../../lib/capabilities/research.js";
import {
  admitConnectionProposal as admitConnectionProposalLib,
  type AdmissionFolderWriter,
} from "../../../lib/capabilities/admission.js";
import { resolveConfiguredCapabilitySigner } from "../../../lib/capabilities/sidecar-signing.js";
import {
  definitionToGql,
  emitRuntimeAuditEvent,
  parseJsonish,
  proposalToGql,
  resolveRuntimeActor,
  versionToGql,
} from "./capabilityRuntime.shared.js";

const REJECTABLE_PROPOSAL_STATUSES = new Set(["draft", "submitted"]);

interface CreateConnectionProposalGqlInput {
  tenantId: string;
  definitionId?: string | null;
  payload: unknown;
  sourceUrls: string[];
}

export async function createConnectionProposal(
  _parent: unknown,
  args: { input: CreateConnectionProposalGqlInput },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "capabilities:propose_connection",
  );
  const actor = await resolveRuntimeActor(ctx);

  const result = await createConnectionProposalLib(db, {
    tenantId: input.tenantId,
    definitionId: input.definitionId ?? null,
    payload: parseJsonish(input.payload),
    sourceUrls: Array.isArray(input.sourceUrls) ? input.sourceUrls : [],
    actor: actor.userId
      ? { type: "user", id: actor.userId }
      : { type: "system" },
  });

  if (result.outcome === "applied" && result.proposal) {
    await emitRuntimeAuditEvent({
      tenantId: input.tenantId,
      actor,
      eventType: "agent.connection_proposal_created",
      resourceType: "capability_proposal",
      resourceId: result.proposal.id,
      action: "create",
      payload: {
        proposalId: result.proposal.id,
        definitionId: result.proposal.definition_id ?? null,
        fingerprint: result.proposal.payload_fingerprint,
        status: result.proposal.status,
      },
    });
  }

  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    proposal: result.proposal ? proposalToGql(result.proposal) : null,
  };
}

interface AdmitConnectionProposalGqlInput {
  tenantId: string;
  proposalId: string;
  reviewedFingerprint: string;
}

export async function admitConnectionProposal(
  _parent: unknown,
  args: { input: AdmitConnectionProposalGqlInput },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  const { input } = args;
  await requireAdminOrServiceCaller(
    ctx,
    input.tenantId,
    "capabilities:admit_connection",
  );
  const actor = await resolveRuntimeActor(ctx);
  // Admission stamps a specific admin identity onto the signed version
  // row — an identity-less service caller cannot ghost-sign as a user.
  if (!actor.userId) {
    return {
      outcome: "rejected",
      reason: "admin_identity_required",
    };
  }

  const signer = await resolveConfiguredCapabilitySigner();
  if (!signer) {
    return { outcome: "rejected", reason: "signing_unavailable" };
  }

  const result = await admitConnectionProposalLib(db, {
    tenantId: input.tenantId,
    proposalId: input.proposalId,
    reviewedFingerprint: input.reviewedFingerprint,
    adminUserId: actor.userId,
    signer,
    folderWriter: platformAgentFolderWriter(),
  });

  if (result.outcome === "applied" && result.definition && result.version) {
    await emitRuntimeAuditEvent({
      tenantId: input.tenantId,
      actor,
      eventType: "agent.connection_proposal_admitted",
      resourceType: "capability_definition",
      resourceId: result.definition.id,
      action: "admit",
      payload: {
        proposalId: input.proposalId,
        definitionId: result.definition.id,
        definitionVersionId: result.version.id,
        version: result.version.version,
        fingerprint: result.version.descriptor_fingerprint,
        slug: result.definition.slug,
        namespace: result.definition.namespace,
        class: result.definition.class,
        ...(result.reason ? { reason: result.reason } : {}),
      },
    });
  }

  const identity = result.definition
    ? {
        namespace: result.definition.namespace,
        class: result.definition.class,
        slug: result.definition.slug,
      }
    : null;
  return {
    outcome: result.outcome,
    reason: result.reason ?? null,
    definition:
      result.definition && result.version
        ? definitionToGql(result.definition, [result.version])
        : null,
    version:
      identity && result.version
        ? versionToGql(identity, result.version)
        : null,
    proposal: result.proposal ? proposalToGql(result.proposal) : null,
  };
}

export async function rejectConnectionProposal(
  _parent: unknown,
  args: { tenantId: string; proposalId: string; reason?: string | null },
  ctx: GraphQLContext,
): Promise<Record<string, unknown>> {
  await requireAdminOrServiceCaller(
    ctx,
    args.tenantId,
    "capabilities:admit_connection",
  );
  const actor = await resolveRuntimeActor(ctx);

  const [proposal] = (await db
    .select()
    .from(capabilityConnectionProposals)
    .where(eq(capabilityConnectionProposals.id, args.proposalId))
    .limit(1)) as CapabilityConnectionProposalRow[];
  if (!proposal || proposal.tenant_id !== args.tenantId) {
    return { outcome: "rejected", reason: "proposal_not_found" };
  }
  if (!REJECTABLE_PROPOSAL_STATUSES.has(proposal.status)) {
    return { outcome: "rejected", reason: "proposal_already_decided" };
  }

  const now = new Date();
  const [updated] = (await db
    .update(capabilityConnectionProposals)
    .set({
      status: "rejected",
      decided_at: now,
      decided_by_user_id: actor.userId,
    })
    .where(eq(capabilityConnectionProposals.id, proposal.id))
    .returning()) as CapabilityConnectionProposalRow[];

  const decided =
    updated ??
    ({
      ...proposal,
      status: "rejected",
      decided_at: now,
      decided_by_user_id: actor.userId,
    } as CapabilityConnectionProposalRow);

  await emitRuntimeAuditEvent({
    tenantId: args.tenantId,
    actor,
    eventType: "agent.connection_proposal_rejected",
    resourceType: "capability_proposal",
    resourceId: proposal.id,
    action: "reject",
    payload: {
      proposalId: proposal.id,
      definitionId: proposal.definition_id ?? null,
      fingerprint: proposal.payload_fingerprint,
      status: "rejected",
      ...(args.reason ? { reason: args.reason } : {}),
    },
  });

  return {
    outcome: "applied",
    reason: null,
    proposal: proposalToGql(decided),
  };
}

// ---------------------------------------------------------------------------
// Folder projection seam
// ---------------------------------------------------------------------------

/**
 * AdmissionFolderWriter over putCapabilityFolder, targeting the tenant's
 * platform default agent workspace prefix. Any failure here is caught by
 * the admission lib and surfaces as reason 'projection_pending' on an
 * applied admission — the signed version row stays authoritative.
 */
function platformAgentFolderWriter(): AdmissionFolderWriter {
  return {
    async write(input) {
      const targetPrefix = await resolvePlatformAgentPrefix(input.tenantId);
      if (!targetPrefix) {
        throw new Error("tenant has no platform default agent workspace");
      }
      // Dynamic import keeps the S3 client out of partially-mocked suites
      // (the capabilityAssignment convention).
      const { putCapabilityFolder } = await import(
        "../../../lib/capabilities/folder-write.js"
      );
      return putCapabilityFolder({
        targetPrefix,
        klass: input.klass,
        slug: input.slug,
        definition: input.definition,
        sidecar: input.sidecar,
        signedBy: input.signedBy,
      });
    },
  };
}

async function resolvePlatformAgentPrefix(
  tenantId: string,
): Promise<string | null> {
  const [agent] = await db
    .select({
      slug: agents.slug,
      workspace_folder_name: agents.workspace_folder_name,
    })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    )
    .limit(1);
  if (!agent?.slug) return null;
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  if (!tenant?.slug) return null;
  const workspaceFolder = agent.workspace_folder_name ?? agent.slug;
  return `tenants/${tenant.slug}/agents/${workspaceFolder}/`;
}
