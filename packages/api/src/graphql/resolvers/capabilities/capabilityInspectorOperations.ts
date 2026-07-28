/**
 * Inspector capability-operation projection (THINK-280 U8).
 *
 * Extends the capability Inspector with the governed-runtime operation layer:
 * for every ADMITTED capability definition version in the tenant it emits one
 * `capability_operation` item carrying the full identity (twcap + signed
 * contract hash), the safe effect/principal/data/budget annotations, the
 * binding readiness + a redacted remediation, and the latest broker/run
 * evidence.
 *
 * Everything is projected through the SAME canonical composer the external
 * search and internal search route through (`projectOperationIdentities`) — the
 * parity anchor. This module NEVER queries a second registry.
 *
 * It is additive and best-effort: a lookup fault yields no operation items
 * rather than failing the whole inspection, and it is only invoked when the
 * caller opts in (broker/external-search rollout gate), so the default
 * inspection path is unchanged.
 */

import { db, and, eq, desc } from "../../utils.js";
import {
  capabilityDefinitions,
  capabilityDefinitionVersions,
  capabilityCredentialBindings,
  capabilityBrokerCalls,
} from "@thinkwork/database-pg/schema";
import {
  projectOperationIdentities,
  type CanonicalOperationIdentity,
} from "../../../lib/capabilities/operation-identity.js";

const LOG_PREFIX = "[capability-inspector-operations]";

export interface CapabilityOperationItem {
  capabilityClass: "capability_operation";
  /** The exact twcap reference — the stable Inspector id + parity anchor. */
  capabilityId: string;
  displayName: string;
  active: boolean;
  provenance: string;
  reason: string | null;
  detail: string | null;
  // ── Operation identity + safe annotations ──
  operationTwcap: string;
  contractHash: string;
  definitionVersionId: string;
  version: number;
  effect: string;
  principalModes: string[];
  approvalPolicy: string;
  inputDataClass: string;
  outputDataClass: string;
  costClass: string;
  latencyClass: string;
  outputClass: string;
  executable: boolean;
  withheldReasons: string[];
  // ── Binding readiness + remediation ──
  readiness: string;
  remediation: string | null;
  latestBrokerCallStatus: string | null;
  latestBrokerCallAt: string | null;
}

type DefinitionRow = typeof capabilityDefinitions.$inferSelect;
type VersionRow = typeof capabilityDefinitionVersions.$inferSelect;
type BindingRow = typeof capabilityCredentialBindings.$inferSelect;

function bestReadiness(bindings: BindingRow[]): {
  readiness: string;
  remediation: string | null;
} {
  if (bindings.length === 0) {
    return {
      readiness: "pending_setup",
      remediation: "no credential binding — operator must complete setup",
    };
  }
  const order = ["ready", "verifying", "degraded", "pending_setup", "revoked"];
  const best = [...bindings].sort(
    (a, b) => order.indexOf(a.readiness) - order.indexOf(b.readiness),
  )[0];
  const remediation =
    best.readiness === "ready"
      ? null
      : best.readiness === "degraded"
        ? "binding degraded — re-verify credentials"
        : best.readiness === "revoked"
          ? "binding revoked — re-authorize"
          : "binding not yet ready — complete verification";
  return { readiness: best.readiness, remediation };
}

/**
 * Project the tenant's admitted capability operations into Inspector items.
 * Best-effort — returns [] on any fault.
 */
export async function projectCapabilityOperationItems(
  tenantId: string,
): Promise<CapabilityOperationItem[]> {
  try {
    const definitions = (await db
      .select()
      .from(capabilityDefinitions)
      .where(eq(capabilityDefinitions.tenant_id, tenantId))) as DefinitionRow[];
    const activeDefs = definitions.filter(
      (row) => row.tenant_id === tenantId && row.status === "active",
    );
    if (activeDefs.length === 0) return [];

    const items: CapabilityOperationItem[] = [];
    for (const def of activeDefs) {
      const versionRows = (await db
        .select()
        .from(capabilityDefinitionVersions)
        .where(
          eq(capabilityDefinitionVersions.definition_id, def.id),
        )) as VersionRow[];
      const admitted = versionRows
        .filter((row) => row.lifecycle === "admitted")
        .sort((a, b) => a.version - b.version)
        .at(-1);
      if (!admitted) continue;

      const identities = projectOperationIdentities(
        { namespace: def.namespace, class: def.class, slug: def.slug },
        admitted,
      );
      if (identities.length === 0) continue;

      const bindings = (await db
        .select()
        .from(capabilityCredentialBindings)
        .where(
          and(
            eq(capabilityCredentialBindings.tenant_id, tenantId),
            eq(capabilityCredentialBindings.definition_version_id, admitted.id),
          ),
        )) as BindingRow[];
      const { readiness, remediation } = bestReadiness(bindings);

      for (const op of identities) {
        const evidence = await latestBrokerEvidence(tenantId, op.contractHash);
        items.push(
          toItem(def, op, readiness, remediation, {
            latestBrokerCallStatus: evidence?.status ?? null,
            latestBrokerCallAt: evidence?.at ?? null,
          }),
        );
      }
    }
    items.sort((a, b) => a.capabilityId.localeCompare(b.capabilityId));
    return items;
  } catch (err) {
    console.warn(
      `${LOG_PREFIX} operation projection unavailable: ${
        err instanceof Error ? err.message : String(err)
      }`,
    );
    return [];
  }
}

function toItem(
  def: DefinitionRow,
  op: CanonicalOperationIdentity,
  readiness: string,
  remediation: string | null,
  evidence: {
    latestBrokerCallStatus: string | null;
    latestBrokerCallAt: string | null;
  },
): CapabilityOperationItem {
  const active = op.executable && readiness === "ready";
  return {
    capabilityClass: "capability_operation",
    capabilityId: op.twcap,
    displayName: `${def.display_name} · ${op.operationId}`,
    active,
    provenance: `admitted definition v${op.version}`,
    reason: active
      ? null
      : !op.executable
        ? "operation_withheld"
        : "binding_not_ready",
    detail: active
      ? null
      : !op.executable
        ? op.withheldReasons.join("; ")
        : (remediation ?? null),
    operationTwcap: op.twcap,
    contractHash: op.contractHash,
    definitionVersionId: op.definitionVersionId,
    version: op.version,
    effect: op.effect,
    principalModes: op.principalModes,
    approvalPolicy: op.approvalPolicy,
    inputDataClass: op.inputDataClass,
    outputDataClass: op.outputDataClass,
    costClass: op.costClass,
    latencyClass: op.latencyClass,
    outputClass: op.outputClass,
    executable: op.executable,
    withheldReasons: op.withheldReasons,
    readiness,
    remediation,
    latestBrokerCallStatus: evidence.latestBrokerCallStatus,
    latestBrokerCallAt: evidence.latestBrokerCallAt,
  };
}

async function latestBrokerEvidence(
  tenantId: string,
  contractHash: string,
): Promise<{ status: string; at: string | null } | null> {
  try {
    const [row] = (await db
      .select()
      .from(capabilityBrokerCalls)
      .where(
        and(
          eq(capabilityBrokerCalls.tenant_id, tenantId),
          eq(capabilityBrokerCalls.contract_hash, contractHash),
        ),
      )
      .orderBy(desc(capabilityBrokerCalls.created_at))
      .limit(1)) as Array<typeof capabilityBrokerCalls.$inferSelect>;
    if (!row) return null;
    return {
      status: row.status,
      at: row.created_at ? row.created_at.toISOString() : null,
    };
  } catch {
    return null;
  }
}
