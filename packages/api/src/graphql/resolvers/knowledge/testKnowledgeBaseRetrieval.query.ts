import { GraphQLError } from "graphql";
import type { GraphQLContext } from "../../context.js";
import { db, eq, knowledgeBases } from "../../utils.js";
import { requireAdminOrServiceCaller } from "../core/authz.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

/**
 * Native, KB-scoped retrieval inspection for operators (U10/KTD8). Runs the
 * same Bedrock `RetrieveCommand` the runtime provider uses, against this one
 * KB, and returns ranked snippets — independent of any Context Engine routing
 * config. `status` distinguishes a never-provisioned KB ("not_provisioned",
 * route the operator to retry) from a provisioned-but-empty one ("ok"), so an
 * unprovisioned KB doesn't look falsely empty.
 */
export const testKnowledgeBaseRetrieval = async (
  _parent: any,
  args: any,
  ctx: GraphQLContext,
) => {
  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(eq(knowledgeBases.id, args.id));
  if (!kb) throw new GraphQLError("Knowledge base not found");
  await requireAdminOrServiceCaller(
    ctx,
    kb.tenant_id,
    "test_knowledge_base_retrieval",
  );

  if (!kb.aws_kb_id) {
    return { status: "not_provisioned", hits: [] };
  }

  const { BedrockAgentRuntimeClient, RetrieveCommand } =
    await import("@aws-sdk/client-bedrock-agent-runtime");
  const client = new BedrockAgentRuntimeClient({ region: REGION });
  const response = await client.send(
    new RetrieveCommand({
      knowledgeBaseId: kb.aws_kb_id,
      retrievalQuery: { text: args.query },
      retrievalConfiguration: {
        vectorSearchConfiguration: { numberOfResults: 10 },
      },
    }),
  );

  const rows = Array.isArray(response.retrievalResults)
    ? response.retrievalResults
    : [];
  const hits = rows
    .map((row, index) => ({
      snippet: extractKbText(row),
      score: typeof row.score === "number" ? row.score : 1 / (index + 1),
      source: extractKbLocation(row),
    }))
    .filter((hit) => hit.snippet);

  return { status: "ok", hits };
};

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
