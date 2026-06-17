import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import {
  emailDomains,
  emailProviderInstalls,
  spaces,
} from "@thinkwork/database-pg/schema";
import type { GraphQLContext } from "../../context.js";

export async function requireEmailProviderInstall(
  ctx: GraphQLContext,
  tenantId: string,
  providerInstallId: string,
) {
  const [row] = await ctx.db
    .select()
    .from(emailProviderInstalls)
    .where(
      and(
        eq(emailProviderInstalls.tenant_id, tenantId),
        eq(emailProviderInstalls.id, providerInstallId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new GraphQLError("Email provider install not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row;
}

export async function requireEmailDomain(
  ctx: GraphQLContext,
  tenantId: string,
  providerInstallId: string,
  domainId: string,
) {
  const [row] = await ctx.db
    .select()
    .from(emailDomains)
    .where(
      and(
        eq(emailDomains.tenant_id, tenantId),
        eq(emailDomains.provider_install_id, providerInstallId),
        eq(emailDomains.id, domainId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new GraphQLError("Email domain not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row;
}

export async function requireEmailSpace(
  ctx: GraphQLContext,
  tenantId: string,
  spaceId: string,
) {
  const [row] = await ctx.db
    .select({ id: spaces.id })
    .from(spaces)
    .where(and(eq(spaces.tenant_id, tenantId), eq(spaces.id, spaceId)))
    .limit(1);
  if (!row) {
    throw new GraphQLError("Space not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row;
}
