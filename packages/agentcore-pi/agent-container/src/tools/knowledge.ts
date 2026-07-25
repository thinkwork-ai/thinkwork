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
  /** 1-based page of the source document, for transcribed page documents. */
  pageNumber?: number;
  /** Human document title, when the ingestion recorded one. */
  docTitle?: string;
  /** The passage came from a page transcribed out of a scan or screenshot,
   * not from a text layer — the agent should attribute it as such. */
  transcribed?: boolean;
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
  pageNumber?: number;
} {
  const s3Uri: string | undefined = result?.location?.s3Location?.uri;
  const customId: string | undefined =
    result?.location?.customDocumentLocation?.id;
  if (customId) {
    // A transcribed document is ingested as one Bedrock document per page
    // under '<s3 key>#p=<n>'. Everything downstream — presigned-URL lookup,
    // the manifest join, the Sources card — keys on the SOURCE document, so
    // the page suffix is stripped here and surfaced as pageNumber instead.
    //
    // The id is where page provenance lives: an RDS-backed vector store
    // cannot carry custom inline metadata attributes (Bedrock writes each one
    // to its own table column, which these tables do not have), so the id and
    // the page's markdown header are the only carriers.
    const page = /#p=(\d+)$/.exec(customId);
    const documentKey = customId.replace(/#p=\d+$/, "");
    return {
      documentKey,
      sourceUri: documentKey,
      ...(page ? { pageNumber: Number(page[1]) } : {}),
    };
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
  pageNumber?: number;
  docTitle?: string;
  transcribed?: boolean;
} {
  const metadata = result?.metadata ?? {};
  const edition = Number(metadata["edition"]);
  const effectiveFrom = metadata["effective_from"];
  const pageNumber = Number(metadata["page_number"]);
  const docTitle = metadata["doc_title"];
  const transcribed = metadata["transcribed"];
  return {
    edition: Number.isFinite(edition) ? edition : undefined,
    effectiveFrom:
      typeof effectiveFrom === "string" ? effectiveFrom : undefined,
    pageNumber: Number.isFinite(pageNumber) ? pageNumber : undefined,
    docTitle: typeof docTitle === "string" ? docTitle : undefined,
    // Bedrock returns inline attributes as strings.
    transcribed: transcribed === "true" || transcribed === true,
  };
}

/**
 * Render hits with a citation marker the agent can reproduce inline.
 *
 * `startAt` continues the numbering across every search_knowledge call in a
 * turn: two searches that both restarted at [1] would make the answer's
 * markers ambiguous, and the reader could not tell which document a claim
 * came from — which is the whole point of citing.
 */
function formatHits(hits: KnowledgeHit[], startAt: number): string {
  if (hits.length === 0) {
    return "No matching passages found in the connected knowledge bases.";
  }
  return hits
    .map((hit, index) => {
      // The document KEY leads the line and stays unadorned: the web Sources
      // card parses it out of this text to resolve a presigned view URL, so
      // every optional part below has to be a suffix that parser can strip.
      const page = hit.pageNumber ? ` (page ${hit.pageNumber})` : "";
      const edition = hit.edition ? ` (edition ${hit.edition})` : "";
      // Say so when the passage was read out of an image, so the agent can
      // attribute it honestly rather than presenting it as source text.
      const provenance = hit.transcribed
        ? " [transcribed from a scan/screenshot]"
        : "";
      const source = hit.documentKey
        ? `\n   Source: ${hit.documentKey}${page}${edition}${provenance}`
        : "";
      const kb = hit.knowledgeBase ? ` [${hit.knowledgeBase}]` : "";
      return `[${startAt + index}]${kb} ${hit.passage.trim()}${source}`;
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
  // One counter per tool instance — i.e. per turn — so citation markers stay
  // unique and stable across repeated searches within the same answer.
  let nextCitation = 1;
  return [
    {
      name: "search_knowledge",
      label: "Search Knowledge",
      description:
        "Verbatim procedure/document search across the knowledge bases connected to this agent" +
        (kbNames.length ? ` (${kbNames.join(", ")})` : "") +
        ". Use memory for what the team knows and has discussed; use this to find and quote " +
        "the authoritative source document (SOPs, procedures, reference sheets). " +
        "Every passage is returned with a citation marker like [1] and its source document. " +
        "CITE INLINE: put the matching marker immediately after each sentence or step it " +
        "supports, e.g. 'Add the new code at the bottom of the list [3].' Markers render as " +
        "links to the exact document and page, so a claim without one cannot be checked. " +
        "Reuse a marker whenever you use that passage again, and never invent a marker " +
        "that was not returned to you.",
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
                    // Hybrid (semantic + keyword), not pure semantic. SOP
                    // corpora are dense with near-identical prose, so the
                    // literal identifiers are what actually separate one
                    // document from another — a short page whose distinctive
                    // signal is "reason code" loses on embedding distance to
                    // long documents that merely discuss the same topic.
                    // Measured on the McPherson CX corpus: the page answering
                    // "how do I set up a new reason code" moved from rank 8 of
                    // 8 (barely inside the window) to rank 1, and two other
                    // questions stopped returning the wrong document first.
                    overrideSearchType: "HYBRID",
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
                // hitMetadata first: identity wins on overlap, because the
                // page number derived from the document id is authoritative.
                ...hitMetadata(result),
                ...hitIdentity(result),
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
        // Claim this call's marker range before rendering, so a second search
        // in the same turn continues the numbering instead of colliding.
        const startAt = nextCitation;
        nextCitation += top.length;
        return {
          content: [{ type: "text" as const, text: formatHits(top, startAt) }],
          details: {
            tenantId: context.tenantId,
            query: trimmed,
            hitCount: top.length,
            knowledgeBaseCount: context.knowledgeBases.length,
            failures: failures.length > 0 ? failures : undefined,
            hits: top.map((hit, index) => ({
              // The marker the answer text refers to. The web thread renders
              // each [n] as a link to this document at this page.
              citation: startAt + index,
              documentKey: hit.documentKey,
              sourceUri: hit.sourceUri,
              score: hit.score,
              edition: hit.edition,
              // Carried through so the Sources card can deep-link the
              // original PDF at the page the passage came from.
              pageNumber: hit.pageNumber,
              docTitle: hit.docTitle,
              transcribed: hit.transcribed || undefined,
              // Short excerpt for the citation hover card.
              quote: hit.passage.trim().slice(0, 320),
            })),
          },
        };
      },
    },
  ];
}
