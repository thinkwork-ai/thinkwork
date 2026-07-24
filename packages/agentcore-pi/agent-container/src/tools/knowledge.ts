import type { AgentTool } from "@earendil-works/pi-agent-core";
import { Type } from "typebox";

/**
 * External S3 KB source U7 — `search_knowledge` as a Pi ToolDef.
 *
 * Retrieves verbatim passages from the Bedrock Knowledge Bases bound to
 * this agent or its Space. Bound-KB resolution happens API-side at
 * wakeup-payload build (KTD6); the container receives IDs and never
 * queries Postgres. The tool is assembled ONLY when the payload carries a
 * non-empty `bound_knowledge_bases` (AE3: agents without bindings are
 * byte-identical to before this feature).
 *
 * R17/R18 invariants: nothing here writes to memory (Hindsight or
 * managed), and nothing imports the context engine — this is a
 * retrieval-time query surface, not an ingestion path.
 */

const MAX_RESULTS_PER_KB = 8;
const MAX_TOTAL_RESULTS = 12;

export interface BoundKnowledgeBase {
  awsKbId: string;
  name?: string | null;
  description?: string | null;
}

export interface KnowledgeToolsContext {
  /** Bound KBs from the wakeup payload (already tenant-scoped API-side). */
  knowledgeBases: BoundKnowledgeBase[];
  /** Tenant id from invocation scope; required before any AWS call. */
  tenantId: string;
  region?: string;
}

export class KnowledgeToolError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "KnowledgeToolError";
  }
}

interface SearchParams {
  query: string;
  max_results?: number;
}

interface KnowledgeHit {
  passage: string;
  score?: number;
  documentKey?: string;
  sourceUri?: string;
  knowledgeBase?: string;
  edition?: number;
  effectiveFrom?: string;
}

function requireScope(context: KnowledgeToolsContext): void {
  if (!context.tenantId || !context.tenantId.trim()) {
    throw new KnowledgeToolError(
      "search_knowledge invoked without a tenantId — the trusted handler must populate it.",
    );
  }
  if (!context.knowledgeBases?.length) {
    throw new KnowledgeToolError(
      "search_knowledge invoked with no bound knowledge bases.",
    );
  }
}

/** Document identity from a Retrieve hit: custom-ingested documents carry
 * the S3 key as their custom id; crawler documents carry the s3 uri. */
function hitIdentity(result: any): {
  documentKey?: string;
  sourceUri?: string;
} {
  const s3Uri: string | undefined = result?.location?.s3Location?.uri;
  const customId: string | undefined =
    result?.location?.customDocumentLocation?.id;
  if (customId) {
    return { documentKey: customId, sourceUri: customId };
  }
  if (s3Uri) {
    return {
      documentKey: s3Uri.replace(/^s3:\/\/[^/]+\//, ""),
      sourceUri: s3Uri,
    };
  }
  return {};
}

/** Manifest metadata rides the hit's metadata attributes where present. */
function hitMetadata(result: any): {
  edition?: number;
  effectiveFrom?: string;
} {
  const metadata = result?.metadata ?? {};
  const edition = Number(metadata["edition"]);
  const effectiveFrom = metadata["effective_from"];
  return {
    edition: Number.isFinite(edition) ? edition : undefined,
    effectiveFrom:
      typeof effectiveFrom === "string" ? effectiveFrom : undefined,
  };
}

function formatHits(hits: KnowledgeHit[]): string {
  if (hits.length === 0) {
    return "No matching passages found in the connected knowledge bases.";
  }
  return hits
    .map((hit, index) => {
      const source = hit.documentKey
        ? `\n   Source: ${hit.documentKey}${hit.edition ? ` (edition ${hit.edition})` : ""}`
        : "";
      const kb = hit.knowledgeBase ? ` [${hit.knowledgeBase}]` : "";
      return `${index + 1}.${kb} ${hit.passage.trim()}${source}`;
    })
    .join("\n\n");
}

/**
 * Build the `search_knowledge` ToolDef. One RetrieveCommand per bound KB,
 * results merged by score with per-hit source attribution.
 */
export function buildKnowledgeTools(
  context: KnowledgeToolsContext,
): AgentTool<any>[] {
  const kbNames = context.knowledgeBases
    .map((kb) => kb.name)
    .filter((name): name is string => !!name);
  return [
    {
      name: "search_knowledge",
      label: "Search Knowledge",
      description:
        "Verbatim procedure/document search across the knowledge bases connected to this agent" +
        (kbNames.length ? ` (${kbNames.join(", ")})` : "") +
        ". Use memory for what the team knows and has discussed; use this to find and quote " +
        "the authoritative source document (SOPs, procedures, reference sheets). " +
        "Results include the source document so you can cite it.",
      parameters: Type.Object({
        query: Type.String({
          description:
            "What to search for — a question, procedure name, or topic.",
        }),
        max_results: Type.Optional(
          Type.Number({
            description: `Maximum passages to return (default ${MAX_TOTAL_RESULTS}).`,
          }),
        ),
      }),
      executionMode: "sequential",
      execute: async (_toolCallId: string, params: unknown) => {
        requireScope(context);
        const { query, max_results } = params as SearchParams;
        const trimmed = (query ?? "").trim();
        if (!trimmed) {
          throw new KnowledgeToolError(
            "search_knowledge called with an empty query.",
          );
        }
        const limit = Math.min(
          Math.max(1, Math.floor(max_results ?? MAX_TOTAL_RESULTS)),
          MAX_TOTAL_RESULTS,
        );

        const { BedrockAgentRuntimeClient, RetrieveCommand } =
          await import("@aws-sdk/client-bedrock-agent-runtime");
        const client = new BedrockAgentRuntimeClient({
          region: context.region || process.env.AWS_REGION || "us-east-1",
        });

        const hits: KnowledgeHit[] = [];
        const failures: string[] = [];
        for (const kb of context.knowledgeBases) {
          try {
            const resp = await client.send(
              new RetrieveCommand({
                knowledgeBaseId: kb.awsKbId,
                retrievalQuery: { text: trimmed },
                retrievalConfiguration: {
                  vectorSearchConfiguration: {
                    numberOfResults: Math.min(limit, MAX_RESULTS_PER_KB),
                  },
                },
              }),
            );
            for (const result of resp.retrievalResults ?? []) {
              const passage = result.content?.text ?? "";
              if (!passage.trim()) continue;
              hits.push({
                passage,
                score: result.score,
                knowledgeBase: kb.name ?? undefined,
                ...hitIdentity(result),
                ...hitMetadata(result),
              });
            }
          } catch (err) {
            failures.push(
              `${kb.name ?? kb.awsKbId}: ${err instanceof Error ? err.message : String(err)}`,
            );
          }
        }

        // Errors are tool-level results, never crashes: with zero successful
        // KBs the agent sees the reason; with partial failures the hits win.
        if (hits.length === 0 && failures.length > 0) {
          return {
            content: [
              {
                type: "text" as const,
                text: `Knowledge search failed: ${failures.join("; ")}`,
              },
            ],
            details: { tenantId: context.tenantId, failures },
          };
        }

        hits.sort((a, b) => (b.score ?? 0) - (a.score ?? 0));
        const top = hits.slice(0, limit);
        return {
          content: [{ type: "text" as const, text: formatHits(top) }],
          details: {
            tenantId: context.tenantId,
            query: trimmed,
            hitCount: top.length,
            knowledgeBaseCount: context.knowledgeBases.length,
            failures: failures.length > 0 ? failures : undefined,
            hits: top.map((hit) => ({
              documentKey: hit.documentKey,
              sourceUri: hit.sourceUri,
              score: hit.score,
              edition: hit.edition,
            })),
          },
        };
      },
    },
  ];
}
