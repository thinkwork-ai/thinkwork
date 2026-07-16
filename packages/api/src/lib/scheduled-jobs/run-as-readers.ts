/**
 * Drizzle-backed implementation of the RunAsFactReaders contract
 * (THINK-302 U7). Kept apart from run-as-facts.ts so that module stays
 * DB-free and trivially unit-testable.
 */

import { db, and, eq } from "../../graphql/utils.js";
import {
  tenantMembers,
  spaces,
  spaceMembers,
} from "@thinkwork/database-pg/schema";
import type { RunAsFactReaders } from "./run-as-facts.js";

const OPERATOR_ROLES = new Set(["owner", "admin"]);

export function createRunAsReaders(): RunAsFactReaders {
  return {
    async isTenantOperator(tenantId, userId) {
      const [row] = await db
        .select({ role: tenantMembers.role, status: tenantMembers.status })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenant_id, tenantId),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, userId),
          ),
        );
      return !!row && row.status === "active" && OPERATOR_ROLES.has(row.role);
    },
    async isActiveTenantMember(tenantId, userId) {
      const [row] = await db
        .select({ status: tenantMembers.status })
        .from(tenantMembers)
        .where(
          and(
            eq(tenantMembers.tenant_id, tenantId),
            eq(tenantMembers.principal_type, "user"),
            eq(tenantMembers.principal_id, userId),
          ),
        );
      return !!row && row.status === "active";
    },
    async spaceAccessMode(spaceId) {
      const [row] = await db
        .select({ access_mode: spaces.access_mode })
        .from(spaces)
        .where(eq(spaces.id, spaceId));
      if (!row) return null;
      return row.access_mode === "private" ? "private" : "public";
    },
    async isSpaceMember(spaceId, userId) {
      const [row] = await db
        .select({ id: spaceMembers.id })
        .from(spaceMembers)
        .where(
          and(
            eq(spaceMembers.space_id, spaceId),
            eq(spaceMembers.user_id, userId),
          ),
        );
      return !!row;
    },
  };
}
