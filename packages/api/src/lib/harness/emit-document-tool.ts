/**
 * emit_document projection for the Harness trial (THINK-311 U5, KTD-3).
 *
 * Presents the same tool surface the Pi document-composer extension gives
 * the model (packages/pi-extensions/src/document-composer.ts): identical
 * field names (snake_case), a genre description built from the dispatch's
 * `document_plates` summaries, and the same success/rejection relay
 * semantics so the model's in-turn self-correction loop works unchanged.
 */

export interface EmitDocumentToolProjection {
  description: string;
  inputSchema: Record<string, unknown>;
}

interface PlateSummaryLike {
  slug?: unknown;
  displayName?: unknown;
  useFor?: unknown;
  sections?: unknown;
  analyses?: unknown;
}

/** Core fallback plates, mirroring the Pi extension's FALLBACK_PLATES. */
const FALLBACK_PLATES = [
  { slug: "report", useFor: "findings, analyses, research results" },
  { slug: "plan", useFor: "plans, roadmaps, proposals for work" },
  { slug: "brief", useFor: "short summaries, status updates" },
  { slug: "ideation", useFor: "brainstorms, option explorations" },
];

export function buildEmitDocumentToolProjection(
  documentPlates: unknown,
): EmitDocumentToolProjection {
  const plates = (
    Array.isArray(documentPlates) && documentPlates.length > 0
      ? (documentPlates as PlateSummaryLike[])
      : FALLBACK_PLATES
  )
    .map((plate) => ({
      slug: typeof plate.slug === "string" ? plate.slug : null,
      useFor: typeof plate.useFor === "string" ? plate.useFor : "",
      hasContract:
        (Array.isArray((plate as PlateSummaryLike).sections) &&
          ((plate as PlateSummaryLike).sections as unknown[]).length > 0) ||
        (Array.isArray((plate as PlateSummaryLike).analyses) &&
          ((plate as PlateSummaryLike).analyses as unknown[]).length > 0),
    }))
    .filter(
      (
        plate,
      ): plate is { slug: string; useFor: string; hasContract: boolean } =>
        Boolean(plate.slug),
    );

  const genreLines = plates
    .map((p) => `- ${p.slug}${p.useFor ? `: ${p.useFor}` : ""}`)
    .join("\n");
  const anyContract = plates.some((p) => p.hasContract);

  const description = [
    "Emit a durable ThinkWork document (plate) from markdown. The platform compiles, validates, and publishes it to the thread.",
    `Available genres:\n${genreLines}`,
    "On rejection, fix every diagnostic and call emit_document again with the corrected digest_markdown. Echo the returned document_id on revisions so the document updates instead of duplicating.",
    ...(anyContract
      ? [
          "Some genres declare required sections and tw:analysis/tw:chart directives — follow the genre's contract exactly; conformance is validated server-side.",
        ]
      : []),
  ].join("\n\n");

  return {
    description,
    inputSchema: {
      type: "object",
      properties: {
        genre: {
          type: "string",
          description: `Plate genre slug. One of:\n${genreLines}`,
        },
        title: { type: "string", description: "Document title." },
        abstract: {
          type: "string",
          description: "One-paragraph abstract of the document.",
        },
        digest_markdown: {
          type: "string",
          description:
            "The full document body as markdown (including any tw: directives the genre requires).",
        },
        status: {
          type: "string",
          enum: ["draft", "final"],
          description: "Publication status. Defaults to draft.",
        },
        document_id: {
          type: "string",
          description:
            "Logical document id returned by a previous emit — echo it to revise the same document.",
        },
        space_id: {
          type: "string",
          description: "Target space id (only valid with status final).",
        },
      },
      required: ["genre", "title", "abstract", "digest_markdown"],
      additionalProperties: false,
    },
  };
}

/**
 * Map the Harness tool-call input (snake_case, per the schema above) onto
 * the `raw` shape `handleDocumentEmission` parses (camelCase — the exact
 * `payload.document` object the Pi tool POSTs).
 */
export function toEmissionRaw(input: unknown): Record<string, unknown> {
  const record = (input ?? {}) as Record<string, unknown>;
  return {
    genre: record.genre,
    title: record.title,
    abstract: record.abstract,
    digestMarkdown: record.digest_markdown ?? record.digestMarkdown,
    ...(record.status != null ? { status: record.status } : {}),
    ...((record.document_id ?? record.documentId)
      ? { documentId: record.document_id ?? record.documentId }
      : {}),
    ...((record.space_id ?? record.spaceId)
      ? { spaceId: record.space_id ?? record.spaceId }
      : {}),
  };
}

export interface EmissionRelay {
  status: "success" | "error";
  text: string;
  /** True for platform defects the model must not retry (run fails). */
  fatal: boolean;
  artifactId?: string;
  documentId?: string;
}

/**
 * Translate a handleDocumentEmission result into the tool-result text the
 * model sees — mirroring the Pi extension's relay (document-composer.ts):
 * success carries document_id; COMPILE_REJECTED/PREFLIGHT_REJECTED format
 * diagnostics for in-turn self-correction; FORBIDDEN/CONFLICT refuse;
 * COMPILER_DEFECT and shape errors are fatal.
 */
export function relayEmissionResultToModel(result: {
  statusCode: number;
  body: Record<string, unknown>;
}): EmissionRelay {
  const body = result.body ?? {};
  if (body.ok === true) {
    const artifactId =
      typeof body.artifactId === "string" ? body.artifactId : undefined;
    const documentId =
      typeof body.documentId === "string" ? body.documentId : undefined;
    const warnings =
      Array.isArray(body.warnings) && body.warnings.length > 0
        ? `\nWarnings: ${JSON.stringify(body.warnings)}`
        : "";
    return {
      status: "success",
      fatal: false,
      artifactId,
      documentId,
      text: `Document ${body.status === "final" ? "published" : "saved as draft"}. document_id: ${documentId ?? "unknown"}. Echo this document_id if you revise it.${warnings}`,
    };
  }
  const code = typeof body.code === "string" ? body.code : "UNKNOWN";
  if (code === "COMPILE_REJECTED" || code === "PREFLIGHT_REJECTED") {
    const diagnostics = Array.isArray(body.diagnostics) ? body.diagnostics : [];
    const lines = diagnostics
      .map((d) => {
        const diag = d as Record<string, unknown>;
        return `- [${diag.code ?? "DIAGNOSTIC"}] ${diag.message ?? ""}${diag.location ? ` (at ${diag.location})` : ""}`;
      })
      .join("\n");
    return {
      status: "error",
      fatal: false,
      text: `REJECTED — the document did not pass validation. Fix every diagnostic below and call emit_document again (same document_id if one was returned):\n${lines || `- ${body.error ?? "validation failed"}`}`,
    };
  }
  if (code === "FORBIDDEN" || code === "CONFLICT") {
    return {
      status: "error",
      fatal: false,
      text: `Emission refused (${code}): ${body.error ?? "not permitted"}. Do not retry with the same input.`,
    };
  }
  if (code === "BAD_REQUEST") {
    return {
      status: "error",
      fatal: false,
      text: `Invalid emit_document input: ${body.error ?? "bad request"}. Correct the fields and call emit_document again.`,
    };
  }
  // COMPILER_DEFECT and anything unrecognized: platform-side failure the
  // model cannot fix — the run must fail rather than loop.
  return {
    status: "error",
    fatal: true,
    text: `Platform document pipeline failure (${code}): ${body.error ?? "internal error"}.`,
  };
}
