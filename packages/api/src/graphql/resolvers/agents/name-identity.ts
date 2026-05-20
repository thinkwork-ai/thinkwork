import { GraphQLError } from "graphql";
import { and, eq, ne, sql } from "drizzle-orm";
import { agents } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export function normalizeAgentMentionName(value: unknown) {
  if (typeof value !== "string") {
    throw new GraphQLError("Agent name must be a non-empty string", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const name = value.trim();
  if (!name) {
    throw new GraphQLError("Agent name must be a non-empty string", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return name;
}

export async function assertAgentMentionNameAvailable(input: {
  tenantId: string;
  name: string;
  excludingAgentId?: string | null;
}) {
  const normalized = input.name.trim().toLowerCase();
  const conditions = [
    eq(agents.tenant_id, input.tenantId),
    ne(agents.status, "archived"),
    sql`lower(trim(${agents.name})) = ${normalized}`,
  ];
  if (input.excludingAgentId) {
    conditions.push(ne(agents.id, input.excludingAgentId));
  }

  const [existing] = await getDb()
    .select({ id: agents.id })
    .from(agents)
    .where(and(...conditions))
    .limit(1);

  if (existing) {
    throw new GraphQLError("Agent name must be unique in this tenant", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}
