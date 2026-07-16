/**
 * Writer-side read of the per-tenant capability-registry-trust flag
 * (THINK-302 U8 — KTD-8 gate).
 *
 * The compile/render side already reads `tenants.capability_registry_trust`
 * (workspace-renderer/repository.ts). The capability WRITERS need the same
 * bit to decide, at grant/detach time, whether to record a scope-qualified
 * `capability_approvals` binding + marker frontmatter (flag ON) or fall back
 * to the byte-identical legacy `.assignment.json` sidecar (flag OFF).
 *
 * The flag is `false` for every tenant today, so every writer runs its legacy
 * branch: this whole path is inert until a tenant is flipped on.
 */

import { eq } from "drizzle-orm";
import { tenants } from "@thinkwork/database-pg/schema";
import type { Db } from "./research.js";
import type { CapabilityScopeRef } from "./approval-registry.js";
import type { CapabilitySignedBy } from "./sidecar-signing.js";

/**
 * Whether the tenant has the capability approval registry turned on. Returns
 * `false` for a missing tenant (fail-closed to the legacy sidecar path — an
 * unknown tenant never silently enters the registry-only regime).
 */
export async function capabilityRegistryTrustEnabled(
  db: Db,
  tenantId: string,
): Promise<boolean> {
  const [row] = await db
    .select({
      capability_registry_trust: tenants.capability_registry_trust,
    })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1);
  return row?.capability_registry_trust === true;
}

/**
 * The context a writer needs to take its registry (flag-ON) branch: the db
 * handle for `recordBinding`, the tenant, the binding scope, and the signer
 * provenance. Callers resolve {@link capabilityRegistryTrustEnabled} FIRST and
 * pass this ONLY when the flag is on — its presence is what selects the ON
 * branch, so the legacy path stays byte-identical (the object is simply
 * absent).
 */
export interface RegistryBindingContext {
  db: Db;
  tenantId: string;
  scopeRef: CapabilityScopeRef;
  signedBy: CapabilitySignedBy;
}
