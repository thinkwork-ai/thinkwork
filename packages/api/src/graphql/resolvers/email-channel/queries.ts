import { and, desc, eq, inArray, sql } from "drizzle-orm";
import {
  EMAIL_READINESS_CHECK_KEYS,
  emailBodyObjects,
  emailDomains,
  emailLedgerEvents,
  emailProviderInstalls,
  emailReadinessChecks,
  emailSpacePolicies,
  emailSpaceSenderAllowlists,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";
import { requirePluginTenantAdmin } from "../plugins/shared.js";
import {
  emailDomainPayload,
  emailLedgerEventPayload,
  emailProviderInstallPayload,
  emailReadinessCheckPayload,
  emailSpacePolicyPayload,
} from "./mappers.js";
import { requireEmailSpace } from "./shared.js";

export async function emailChannelSummary(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const [
    providers,
    domains,
    readinessChecks,
    policies,
    allowlists,
    [countRow],
  ] = await Promise.all([
    ctx.db
      .select()
      .from(emailProviderInstalls)
      .where(eq(emailProviderInstalls.tenant_id, tenantId))
      .orderBy(desc(emailProviderInstalls.updated_at)),
    ctx.db
      .select()
      .from(emailDomains)
      .where(eq(emailDomains.tenant_id, tenantId))
      .orderBy(desc(emailDomains.updated_at)),
    ctx.db
      .select()
      .from(emailReadinessChecks)
      .where(eq(emailReadinessChecks.tenant_id, tenantId))
      .orderBy(desc(emailReadinessChecks.updated_at)),
    ctx.db
      .select()
      .from(emailSpacePolicies)
      .where(eq(emailSpacePolicies.tenant_id, tenantId))
      .orderBy(desc(emailSpacePolicies.updated_at)),
    ctx.db
      .select()
      .from(emailSpaceSenderAllowlists)
      .where(eq(emailSpaceSenderAllowlists.tenant_id, tenantId)),
    ctx.db
      .select({ value: sql<number>`count(*)::int` })
      .from(emailLedgerEvents)
      .where(eq(emailLedgerEvents.tenant_id, tenantId)),
  ]);

  const allowlistsBySpace = allowlists.reduce(
    (acc, row) => {
      acc[row.space_id] = acc[row.space_id] ?? [];
      acc[row.space_id]!.push(row);
      return acc;
    },
    {} as Record<string, typeof allowlists>,
  );
  const activeProvider = providers.find(
    (provider) => provider.active_for_production,
  );
  const blockingReadinessChecks = readinessChecks.filter((check) =>
    ["fail", "blocked"].includes(check.status),
  );
  const requiredChecksPassed = activeProvider
    ? EMAIL_READINESS_CHECK_KEYS.every((key) =>
        readinessChecks.some(
          (check) =>
            check.provider_install_id === activeProvider.id &&
            check.check_key === key &&
            check.status === "pass",
        ),
      )
    : false;
  const hasVerifiedDomain = activeProvider
    ? domains.some(
        (domain) =>
          domain.provider_install_id === activeProvider.id &&
          domain.status === "verified",
      )
    : false;
  const productionReady = Boolean(
    activeProvider &&
      activeProvider.status === "ready" &&
      hasVerifiedDomain &&
      requiredChecksPassed &&
      blockingReadinessChecks.length === 0,
  );

  return {
    providers: providers.map(emailProviderInstallPayload),
    domains: domains.map(emailDomainPayload),
    readinessChecks: readinessChecks.map(emailReadinessCheckPayload),
    spacePolicies: policies.map((policy) =>
      emailSpacePolicyPayload(policy, allowlistsBySpace[policy.space_id] ?? []),
    ),
    productionReady,
    blockingReadinessChecks: blockingReadinessChecks.map(
      emailReadinessCheckPayload,
    ),
    ledgerEventCount: countRow?.value ?? 0,
  };
}

export async function emailSpaceEmailPolicy(
  _parent: unknown,
  args: { spaceId: string },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  await requireEmailSpace(ctx, tenantId, args.spaceId);
  const [policy] = await ctx.db
    .select()
    .from(emailSpacePolicies)
    .where(
      and(
        eq(emailSpacePolicies.tenant_id, tenantId),
        eq(emailSpacePolicies.space_id, args.spaceId),
      ),
    )
    .limit(1);
  if (!policy) return null;
  const allowlists = await ctx.db
    .select()
    .from(emailSpaceSenderAllowlists)
    .where(
      and(
        eq(emailSpaceSenderAllowlists.tenant_id, tenantId),
        eq(emailSpaceSenderAllowlists.space_id, args.spaceId),
      ),
    );
  return emailSpacePolicyPayload(policy, allowlists);
}

export async function emailChannelLedger(
  _parent: unknown,
  args: {
    conversationId?: string | null;
    spaceId?: string | null;
    limit?: number | null;
  },
  ctx: GraphQLContext,
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const conditions = [eq(emailLedgerEvents.tenant_id, tenantId)];
  if (args.conversationId) {
    conditions.push(eq(emailLedgerEvents.conversation_id, args.conversationId));
  }
  if (args.spaceId) {
    await requireEmailSpace(ctx, tenantId, args.spaceId);
    conditions.push(eq(emailLedgerEvents.space_id, args.spaceId));
  }
  const limit = Math.min(Math.max(args.limit ?? 50, 1), 100);
  const rows = await ctx.db
    .select()
    .from(emailLedgerEvents)
    .where(and(...conditions))
    .orderBy(desc(emailLedgerEvents.created_at))
    .limit(limit);
  const bodyIds = rows
    .map((row) => row.body_object_id)
    .filter((id): id is string => Boolean(id));
  const bodies =
    bodyIds.length > 0
      ? await ctx.db
          .select()
          .from(emailBodyObjects)
          .where(
            and(
              eq(emailBodyObjects.tenant_id, tenantId),
              inArray(emailBodyObjects.id, bodyIds),
            ),
          )
      : [];
  const bodiesById = new Map(bodies.map((body) => [body.id, body]));
  return rows.map((row) =>
    emailLedgerEventPayload(
      row,
      row.body_object_id ? bodiesById.get(row.body_object_id) : null,
    ),
  );
}

export const emailChannelQueries = {
  emailChannelSummary,
  emailSpaceEmailPolicy,
  emailChannelLedger,
};
