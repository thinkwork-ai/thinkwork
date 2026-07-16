/**
 * Shared projection + audit helpers for the governed capability runtime
 * GraphQL surface (THINK-280 U2).
 *
 * Row → GraphQL mapping is EXPLICIT field-by-field construction, never a
 * spread: `credential_refs_json` (and any future secret-adjacent column)
 * can therefore never leak into a response by accident. AWSJSON fields
 * follow the repo convention (snakeToCamel in graphql/utils.ts): jsonb
 * columns are JSON.stringify'd and the AWSJSON scalar's serialize parses
 * them back — internal callers and the wire both stay consistent.
 *
 * `CapabilityDefinitionVersion.operations` derives from the SIGNED
 * descriptor via @thinkwork/capability-contracts. A malformed stored
 * descriptor must never crash a whole catalog query: that version renders
 * with `operations: []` and a server-side log line.
 */

import { GraphQLError } from "graphql";
import {
  formatTwcapRef,
  operationExecutabilityViolations,
  type CapabilityDescriptor,
} from "@thinkwork/capability-contracts";
import { db, inArray } from "../../utils.js";
import { capabilityDefinitionVersions } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { emitAuditEvent } from "../../../lib/compliance/emit.js";
import type { ComplianceEventType } from "@thinkwork/database-pg/schema";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";
import type {
  CapabilityConnectionProposalRow,
  CapabilityDefinitionRow,
} from "../../../lib/capabilities/research.js";
import type { CapabilityDefinitionVersionRow } from "../../../lib/capabilities/admission.js";
import type { CapabilityCredentialBindingRow } from "../../../lib/capabilities/readiness.js";

const LOG_PREFIX = "[capability-runtime]";

export function badInput(message: string): GraphQLError {
  return new GraphQLError(message, { extensions: { code: "BAD_USER_INPUT" } });
}

// ---------------------------------------------------------------------------
// AWSJSON tolerance
// ---------------------------------------------------------------------------

/**
 * AWSJSON dual wire shape (THINK-188 convention): inputs arrive as JSON
 * strings over the AppSync-compatible wire but as plain values from
 * internal callers/tests. A parse failure falls through to the domain
 * lib's own fail-closed shape validation.
 */
export function parseJsonish(value: unknown): unknown {
  if (typeof value !== "string") return value;
  try {
    return JSON.parse(value);
  } catch {
    return value;
  }
}

function awsJson(value: unknown): string {
  return JSON.stringify(value ?? null);
}

function iso(value: Date | string | null | undefined): string | null {
  if (value instanceof Date) return value.toISOString();
  return value ?? null;
}

// ---------------------------------------------------------------------------
// Row → GraphQL projections (explicit field lists — never spreads)
// ---------------------------------------------------------------------------

export interface CapabilityOperationViewGql {
  operationId: string;
  twcap: string;
  contractHash: string;
  effect: string;
  principalModes: string[];
  approvalPolicy: string;
  costClass: string;
  latencyClass: string;
  outputClass: string;
  executable: boolean;
  withheldReasons: string[];
}

interface DefinitionIdentity {
  namespace: string;
  class: string;
  slug: string;
}

/**
 * Derive the per-operation view from a stored descriptor + contract-hash
 * projection. Fail-soft by contract: any malformed shape yields `[]` with
 * a server-side log — one bad version must not take down the query.
 */
export function deriveOperationViews(
  identity: DefinitionIdentity,
  row: Pick<
    CapabilityDefinitionVersionRow,
    "id" | "version" | "descriptor_json" | "contract_hashes_json"
  >,
): CapabilityOperationViewGql[] {
  try {
    const descriptor = row.descriptor_json as CapabilityDescriptor;
    if (
      !descriptor ||
      typeof descriptor !== "object" ||
      !Array.isArray(descriptor.operations)
    ) {
      throw new Error("descriptor_json is not a descriptor object");
    }
    const hashes =
      row.contract_hashes_json && typeof row.contract_hashes_json === "object"
        ? (row.contract_hashes_json as Record<string, unknown>)
        : {};
    return descriptor.operations.map((op) => {
      const contractHash = hashes[op.operationId];
      if (typeof contractHash !== "string") {
        throw new Error(
          `missing contract hash for operation '${op.operationId}'`,
        );
      }
      const withheldReasons = operationExecutabilityViolations(op);
      return {
        operationId: op.operationId,
        twcap: formatTwcapRef({
          namespace: identity.namespace,
          class: identity.class,
          slug: identity.slug,
          version: String(row.version),
          operationId: op.operationId,
          contractHash,
        }),
        contractHash,
        effect: op.effect,
        principalModes: [...op.principalModes],
        approvalPolicy: op.approvalPolicy,
        costClass: op.costClass,
        latencyClass: op.latencyClass,
        outputClass: op.outputClass,
        executable: withheldReasons.length === 0,
        withheldReasons,
      };
    });
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} skipping operations projection for version ${row.id}: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

export function versionToGql(
  identity: DefinitionIdentity,
  row: CapabilityDefinitionVersionRow,
): Record<string, unknown> {
  return {
    id: row.id,
    definitionId: row.definition_id,
    version: row.version,
    lifecycle: row.lifecycle,
    descriptorFingerprint: row.descriptor_fingerprint,
    descriptor: awsJson(row.descriptor_json),
    contractHashes: awsJson(row.contract_hashes_json),
    provenance: awsJson(row.provenance_json),
    signature: awsJson(row.signature_json ?? null),
    sourceProposalId: row.source_proposal_id ?? null,
    admittedAt: iso(row.admitted_at),
    admittedByUserId: row.admitted_by_user_id ?? null,
    admissionMode: row.admission_mode ?? "operator",
    admittedByAgentId: row.admitted_by_agent_id ?? null,
    createdAt: iso(row.created_at),
    operations: deriveOperationViews(identity, row),
  };
}

export function definitionToGql(
  row: CapabilityDefinitionRow,
  versionRows: CapabilityDefinitionVersionRow[],
): Record<string, unknown> {
  const identity = {
    namespace: row.namespace,
    class: row.class,
    slug: row.slug,
  };
  const sorted = [...versionRows].sort((a, b) => a.version - b.version);
  const versions = sorted.map((v) => versionToGql(identity, v));
  const admittedRow = sorted.filter((v) => v.lifecycle === "admitted").at(-1);
  return {
    id: row.id,
    tenantId: row.tenant_id ?? null,
    namespace: row.namespace,
    class: row.class,
    slug: row.slug,
    displayName: row.display_name,
    status: row.status,
    createdAt: iso(row.created_at),
    versions,
    admittedVersion: admittedRow ? versionToGql(identity, admittedRow) : null,
  };
}

export function proposalToGql(
  row: CapabilityConnectionProposalRow,
): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    definitionId: row.definition_id ?? null,
    payload: awsJson(row.payload_json),
    payloadFingerprint: row.payload_fingerprint,
    provenance: awsJson(row.provenance_json),
    status: row.status,
    inboxItemId: row.inbox_item_id ?? null,
    createdByActorType: row.created_by_actor_type ?? null,
    createdByActorId: row.created_by_actor_id ?? null,
    decidedAt: iso(row.decided_at),
    decidedByUserId: row.decided_by_user_id ?? null,
    createdAt: iso(row.created_at),
  };
}

export interface TenantServicePrincipalRowLike {
  id: string;
  tenant_id: string;
  slug: string;
  display_name: string;
  purpose: string | null;
  status: string;
  created_at: Date | null;
  revoked_at: Date | null;
}

export function servicePrincipalToGql(
  row: TenantServicePrincipalRowLike,
): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    slug: row.slug,
    displayName: row.display_name,
    purpose: row.purpose ?? null,
    status: row.status,
    createdAt: iso(row.created_at),
    revokedAt: iso(row.revoked_at),
  };
}

/**
 * Binding projection. `credential_refs_json` is DELIBERATELY absent — the
 * explicit field list is the structural guarantee that vault references
 * never cross the GraphQL boundary.
 */
export function bindingToGql(
  row: CapabilityCredentialBindingRow,
): Record<string, unknown> {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    definitionVersionId: row.definition_version_id,
    principalMode: row.principal_mode,
    servicePrincipalId: row.service_principal_id ?? null,
    subjectUserId: row.subject_user_id ?? null,
    readiness: row.readiness,
    readinessEvidence: awsJson(row.readiness_evidence_json),
    lastVerifiedAt: iso(row.last_verified_at),
    revokedAt: iso(row.revoked_at),
    createdAt: iso(row.created_at),
  };
}

// ---------------------------------------------------------------------------
// Version loading
// ---------------------------------------------------------------------------

export async function loadVersionRowsByDefinition(
  definitionIds: string[],
): Promise<Map<string, CapabilityDefinitionVersionRow[]>> {
  const map = new Map<string, CapabilityDefinitionVersionRow[]>();
  if (definitionIds.length === 0) return map;
  const rows = (await db
    .select()
    .from(capabilityDefinitionVersions)
    .where(
      inArray(capabilityDefinitionVersions.definition_id, definitionIds),
    )) as CapabilityDefinitionVersionRow[];
  for (const row of rows) {
    const list = map.get(row.definition_id) ?? [];
    list.push(row);
    map.set(row.definition_id, list);
  }
  return map;
}

// ---------------------------------------------------------------------------
// Audit
// ---------------------------------------------------------------------------

export interface RuntimeAuditActor {
  actorId: string;
  actorType: "user" | "system";
  userId: string | null;
}

/** auditBase convention: user identity when resolvable, 'service' otherwise. */
export async function resolveRuntimeActor(
  ctx: GraphQLContext,
): Promise<RuntimeAuditActor> {
  const userId = (await resolveCallerUserId(ctx)) ?? null;
  return {
    actorId: userId ?? "service",
    actorType: userId ? "user" : "system",
    userId,
  };
}

/**
 * Emit one capability-runtime audit event in a dedicated transaction
 * (the write substrate committed already — losing the trail must be
 * loud, mirroring the capabilityAssignment driver).
 */
export async function emitRuntimeAuditEvent(input: {
  tenantId: string;
  actor: RuntimeAuditActor;
  eventType: ComplianceEventType;
  resourceType: string;
  resourceId: string;
  action: string;
  payload: Record<string, unknown>;
}): Promise<void> {
  await db.transaction(async (tx) => {
    await emitAuditEvent(tx, {
      tenantId: input.tenantId,
      actorId: input.actor.actorId,
      actorType: input.actor.actorType,
      eventType: input.eventType,
      source: "graphql",
      resourceType: input.resourceType,
      resourceId: input.resourceId,
      action: input.action,
      outcome: "success",
      payload: input.payload,
    });
  });
}
