import {
  BedrockAgentRuntimeClient,
  RetrieveCommand,
} from "@aws-sdk/client-bedrock-agent-runtime";
import { and, eq } from "drizzle-orm";
import {
  agentKnowledgeBases,
  db,
  knowledgeBases,
  spaceKnowledgeBases,
} from "../../../graphql/utils.js";
import type {
  ContextHit,
  ContextProviderDescriptor,
  ContextProviderResult,
} from "../types.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

export function createBedrockKnowledgeBaseContextProvider(): ContextProviderDescriptor {
  return {
    id: "bedrock-knowledge-base",
    family: "knowledge-base",
    displayName: "Bedrock Knowledge Bases",
    defaultEnabled: true,
    supportedScopes: ["team", "auto"],
    timeoutMs: 8_000,
    async query(request): Promise<ContextProviderResult> {
      const kbs = await listKnowledgeBases(
        request.caller.tenantId,
        request.caller.agentId,
        request.caller.spaceId,
      );
      if (kbs.length === 0) {
        return {
          hits: [],
          status: {
            state: "skipped",
            reason: "no enabled Bedrock Knowledge Bases are available",
          },
        };
      }

      const client = new BedrockAgentRuntimeClient({ region: REGION });
      const hits: ContextHit[] = [];
      const errors: string[] = [];
      await Promise.all(
        kbs.map(async (kb) => {
          try {
            const awsKbId = kb.awsKbId;
            if (!awsKbId) return;
            const response = await client.send(
              new RetrieveCommand({
                knowledgeBaseId: awsKbId,
                retrievalQuery: { text: request.query },
                retrievalConfiguration: {
                  vectorSearchConfiguration: {
                    numberOfResults: Math.min(request.limit, 10),
                  },
                },
              }),
            );
            const rows = Array.isArray(response.retrievalResults)
              ? response.retrievalResults
              : [];
            for (const [index, row] of rows.entries()) {
              const text = extractKbText(row);
              if (!text) continue;
              const sourceId = `${kb.id}:${index}:${extractKbLocation(row) ?? ""}`;
              hits.push({
                id: `kb:${sourceId}`,
                providerId: "bedrock-knowledge-base",
                family: "knowledge-base",
                title: kb.name,
                snippet: text,
                score:
                  typeof row.score === "number" ? row.score : 1 / (index + 1),
                scope: request.scope,
                provenance: {
                  label: kb.name,
                  sourceId,
                  uri: extractKbLocation(row) ?? undefined,
                  metadata: {
                    knowledgeBaseId: kb.id,
                    awsKbId,
                    location: row.location,
                  },
                },
                metadata: {
                  knowledgeBaseId: kb.id,
                  metadata: row.metadata ?? {},
                },
              });
            }
          } catch (err) {
            errors.push(
              `${kb.name}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }),
      );

      return {
        hits,
        status:
          errors.length > 0
            ? {
                state: hits.length > 0 ? "ok" : "error",
                error: errors.join("; "),
              }
            : undefined,
      };
    },
  };
}

type KbRow = { id: string; name: string; awsKbId: string | null };

/**
 * Union the agent's (tenant-wide) KBs with the thread's Space-bound KBs (U7).
 *
 * In the single-agent-per-tenant model, agentId is the tenant's platform agent
 * (tenant-wide KBs) and spaceId scopes additional KBs to one Space. The two are
 * unioned and deduped so a KB bound at both scopes contributes once (AE2).
 *
 * Both queries are tenant-scoped — the space query filters
 * `space_knowledge_bases.tenant_id`, so a thread whose Space belongs to another
 * tenant yields no rows (tenant isolation). When neither an agent nor a Space is
 * in context, the prior tenant-wide fallback is preserved; tightening that
 * fallback (KTD4) is deferred pending a caller audit.
 */
async function listKnowledgeBases(
  tenantId: string,
  agentId?: string | null,
  spaceId?: string | null,
): Promise<KbRow[]> {
  const lists: KbRow[][] = [];
  if (agentId) lists.push(await agentBoundKbs(tenantId, agentId));
  if (spaceId) lists.push(await spaceBoundKbs(tenantId, spaceId));
  if (lists.length === 0) lists.push(await allTenantKbs(tenantId));
  return dedupeKnowledgeBases(lists.flat());
}

/** Union + dedup by KB id, dropping any KB without a provisioned aws_kb_id. */
export function dedupeKnowledgeBases(rows: KbRow[]): KbRow[] {
  const byId = new Map<string, KbRow>();
  for (const row of rows) {
    if (!row.awsKbId) continue;
    if (!byId.has(row.id)) byId.set(row.id, row);
  }
  return [...byId.values()];
}

async function agentBoundKbs(
  tenantId: string,
  agentId: string,
): Promise<KbRow[]> {
  return await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      awsKbId: knowledgeBases.aws_kb_id,
    })
    .from(agentKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      eq(agentKnowledgeBases.knowledge_base_id, knowledgeBases.id),
    )
    .where(
      and(
        eq(agentKnowledgeBases.agent_id, agentId),
        eq(agentKnowledgeBases.enabled, true),
        eq(agentKnowledgeBases.tenant_id, tenantId),
        eq(knowledgeBases.tenant_id, tenantId),
      ),
    );
}

async function spaceBoundKbs(
  tenantId: string,
  spaceId: string,
): Promise<KbRow[]> {
  return await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      awsKbId: knowledgeBases.aws_kb_id,
    })
    .from(spaceKnowledgeBases)
    .innerJoin(
      knowledgeBases,
      eq(spaceKnowledgeBases.knowledge_base_id, knowledgeBases.id),
    )
    .where(
      and(
        eq(spaceKnowledgeBases.space_id, spaceId),
        eq(spaceKnowledgeBases.enabled, true),
        eq(spaceKnowledgeBases.tenant_id, tenantId),
        eq(knowledgeBases.tenant_id, tenantId),
      ),
    );
}

async function allTenantKbs(tenantId: string): Promise<KbRow[]> {
  return await db
    .select({
      id: knowledgeBases.id,
      name: knowledgeBases.name,
      awsKbId: knowledgeBases.aws_kb_id,
    })
    .from(knowledgeBases)
    .where(eq(knowledgeBases.tenant_id, tenantId));
}

function extractKbText(row: any): string {
  const content = row?.content;
  if (typeof content?.text === "string") return content.text;
  if (Array.isArray(content)) {
    return content
      .map((item) => (typeof item?.text === "string" ? item.text : ""))
      .join("\n")
      .trim();
  }
  return "";
}

function extractKbLocation(row: any): string | null {
  const location = row?.location;
  if (!location || typeof location !== "object") return null;
  const typed = Object.values(location).find(
    (value) => value && typeof value === "object",
  ) as Record<string, unknown> | undefined;
  if (!typed) return null;
  for (const value of Object.values(typed)) {
    if (typeof value === "string" && value) return value;
  }
  return null;
}
