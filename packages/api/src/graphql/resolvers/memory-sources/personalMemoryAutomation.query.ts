/**
 * personalMemoryAutomation — the signed-in user's Personal Memory Automation
 * (THINK-193 U3, R4-R6).
 *
 * OWNER-ONLY by construction: the automation is resolved from the caller's
 * own user id — there is no argument to read another user's. Lazily ensures
 * the processor + agent_private workflow + current blueprint version so the
 * first configuration read provisions everything.
 */

import { and, eq } from "drizzle-orm";
import { connections, connectProviders } from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { db } from "../../utils.js";
import { ensurePersonalMemoryAutomation } from "../../../lib/memory-sources/provisioning.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import {
  toGraphqlManagedMemoryWorkflow,
  type ReadinessReason,
} from "./managed-memory-workflow.js";

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function personalMemoryAutomation(
  _parent: unknown,
  _args: unknown,
  ctx: GraphQLContext,
) {
  const tenantId = ctx.auth.tenantId ?? (await resolveCallerTenantId(ctx));
  if (!tenantId) throw new Error("Tenant context required");
  const userId = await resolveCallerUserId(ctx);
  if (!userId) {
    throw new Error(
      "A signed-in user is required — personal memory automations belong to a user, not a service caller",
    );
  }

  const ensured = await ensurePersonalMemoryAutomation(db, {
    tenantId,
    userId,
  });

  // U6: surface the CONNECT STATE of each email source's backing Google
  // connection as readiness reasons (a cheap row-status read — no token
  // resolution/refresh on a page load; the run-time adapter readiness does
  // the full fail-closed check).
  const extraReasons: ReadinessReason[] = [];
  for (const source of ensured.sources) {
    if (source.source_family !== "email" || !source.enabled) continue;
    if (!UUID_RE.test(source.source_binding_key)) {
      extraReasons.push({
        code: "email_connection_missing",
        message:
          "The email source's binding is not a valid connection — reconnect Google in Integrations and re-add the source.",
      });
      continue;
    }
    const [row] = await db
      .select({ status: connections.status })
      .from(connections)
      .innerJoin(
        connectProviders,
        eq(connections.provider_id, connectProviders.id),
      )
      .where(
        and(
          eq(connections.id, source.source_binding_key),
          eq(connections.tenant_id, tenantId),
          eq(connections.user_id, userId),
          eq(connectProviders.name, "google_productivity"),
        ),
      )
      .limit(1);
    if (!row) {
      extraReasons.push({
        code: "email_connection_missing",
        message:
          "The Google connection backing your email source is missing or not yours — reconnect Google in Integrations.",
      });
    } else if (row.status !== "active") {
      extraReasons.push({
        code: `email_connection_${row.status}`,
        message: `Your Google connection is ${row.status} — reconnect Google in Integrations to resume email processing.`,
      });
    }
  }

  return toGraphqlManagedMemoryWorkflow(ensured, extraReasons);
}
