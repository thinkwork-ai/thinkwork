/**
 * Document Compositor v2 (THINK-154 U5): the `emit_document` tool, v2 shape.
 *
 * The agent authors MARKDOWN ONLY — frontmatter + prose + `tw:` directive
 * blocks in `digest_markdown`. There is no `render_html` parameter: the
 * platform compiles the house-style HTML render server-side at emission
 * (enforcement-over-nudge — freestyle HTML is impossible by construction,
 * KTD3). The server accepts the legacy dual-body shape from lagging customer
 * runtimes independently of this schema (R8).
 *
 * Compile/preflight rejects come back on the same synchronous call and are
 * returned VERBATIM as the tool result so the model self-corrects in-turn.
 *
 * Registration is unconditional (gated only on the standard wiring fields and
 * not eval_mode) — R6 is satisfied a fortiori with no new dispatch-payload
 * flag. The host MUST fold the tool name into the session allowlist via
 * `addExtension` or it registers but never reaches the model.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

export const EMIT_DOCUMENT_TOOL_NAME = "emit_document";

/** One registered plate on the tenant's emit_document tool surface (R10). */
export interface DocumentPlateSummary {
  slug: string;
  displayName: string;
  useFor: string;
  /**
   * THINK-183 KTD8: enforced content contract, when the plate declares one.
   * Sections are required (or required-if-material — waive with tw:waiver
   * when the data is genuinely unavailable); analyses name plate-declared
   * server-computed calculations authored via tw:analysis blocks.
   */
  sections?: Array<{
    id: string;
    title: string;
    tier: "required" | "required-if-material";
  }>;
  analyses?: Array<{ key: string; op: string; inputHint: string }>;
}

/**
 * Fallback surface when the dispatch payload carries no `document_plates`
 * field (older server or lagging customer stack). Server-side registry
 * validation remains the authority either way (KTD4).
 */
export const FALLBACK_PLATES: readonly DocumentPlateSummary[] = [
  {
    slug: "report",
    displayName: "Report",
    useFor:
      "General findings and analysis presented as a narrative with evidence.",
  },
  {
    slug: "plan",
    displayName: "Plan",
    useFor: "A course of action: phases, workstreams, owners, and sequencing.",
  },
  {
    slug: "brief",
    displayName: "Decision Brief",
    useFor: "A decision brief: options, tradeoffs, and a recommendation.",
  },
  {
    slug: "ideation",
    displayName: "Ideation",
    useFor: "Exploratory thinking: directions, concepts, and open questions.",
  },
];

const PLATE_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/**
 * Normalize the payload's `document_plates` field. A missing or malformed
 * field (wrong shape, junk entries only) is treated as ABSENT — the caller
 * falls back to the core four and logs a structured event — never a throw.
 */
/** THINK-183 KTD8: carry a plate's contract sections; junk degrades to absent. */
function normalizePlateSections(
  raw: unknown,
): DocumentPlateSummary["sections"] {
  if (!Array.isArray(raw)) return undefined;
  const sections: NonNullable<DocumentPlateSummary["sections"]> = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const id = typeof rec.id === "string" ? rec.id.trim() : "";
    const title = typeof rec.title === "string" ? rec.title.trim() : "";
    const tier = rec.tier;
    if (
      !PLATE_SLUG_RE.test(id) ||
      !title ||
      (tier !== "required" && tier !== "required-if-material")
    ) {
      continue;
    }
    sections.push({ id, title, tier });
  }
  return sections.length > 0 ? sections : undefined;
}

/** THINK-183 KTD8: carry a plate's declared analyses; junk degrades to absent. */
function normalizePlateAnalyses(
  raw: unknown,
): DocumentPlateSummary["analyses"] {
  if (!Array.isArray(raw)) return undefined;
  const analyses: NonNullable<DocumentPlateSummary["analyses"]> = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const key = typeof rec.key === "string" ? rec.key.trim() : "";
    const op = typeof rec.op === "string" ? rec.op.trim() : "";
    if (!PLATE_SLUG_RE.test(key) || !op) continue;
    analyses.push({
      key,
      op,
      inputHint: typeof rec.inputHint === "string" ? rec.inputHint.trim() : "",
    });
  }
  return analyses.length > 0 ? analyses : undefined;
}

export function normalizeDocumentPlates(
  raw: unknown,
): DocumentPlateSummary[] | null {
  if (!Array.isArray(raw)) return null;
  const plates: DocumentPlateSummary[] = [];
  for (const entry of raw) {
    if (entry === null || typeof entry !== "object" || Array.isArray(entry)) {
      continue;
    }
    const rec = entry as Record<string, unknown>;
    const slug = typeof rec.slug === "string" ? rec.slug.trim() : "";
    if (!PLATE_SLUG_RE.test(slug)) continue;
    const sections = normalizePlateSections(rec.sections);
    const analyses = normalizePlateAnalyses(rec.analyses);
    plates.push({
      slug,
      displayName:
        typeof rec.displayName === "string" && rec.displayName.trim()
          ? rec.displayName.trim()
          : slug,
      useFor: typeof rec.useFor === "string" ? rec.useFor.trim() : "",
      ...(sections ? { sections } : {}),
      ...(analyses ? { analyses } : {}),
    });
  }
  return plates.length > 0 ? plates : null;
}

/**
 * Local fast-fail ceiling. Kept in sync with the server-side source of truth
 * in packages/api/src/lib/artifacts/document-preflight.ts (DocSpector) — the
 * server always re-checks; this only saves a wasted round trip.
 */
export const EMIT_DOCUMENT_DIGEST_MAX_BYTES = 96 * 1024;

export interface DocumentComposerConfig {
  apiUrl?: string;
  apiSecret?: string;
  tenantId?: string;
  threadId?: string;
  threadTurnId?: string;
  agentId?: string;
  /** Raw `document_plates` dispatch-payload field (KTD4); normalized here. */
  documentPlates?: unknown;
}

export interface DocumentComposerExtensionOptions {
  documentComposerConfig?: DocumentComposerConfig;
  fetchImpl?: typeof fetch;
}

function asString(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function byteLength(value: string): number {
  return new TextEncoder().encode(value).length;
}

export function createDocumentComposerExtension(
  options: DocumentComposerExtensionOptions,
): ThinkworkExtension {
  const config = options.documentComposerConfig;
  const apiUrl = asString(config?.apiUrl).replace(/\/+$/, "");
  const apiSecret = asString(config?.apiSecret);
  const tenantId = asString(config?.tenantId);
  const threadId = asString(config?.threadId);
  const threadTurnId = asString(config?.threadTurnId);
  const agentId = asString(config?.agentId);
  const enabled = Boolean(
    apiUrl && apiSecret && tenantId && threadId && threadTurnId,
  );

  return defineExtension({
    name: "thinkwork-document-composer",
    toolNames: enabled ? [EMIT_DOCUMENT_TOOL_NAME] : [],
    register(pi) {
      if (!enabled) return;
      const fetchImpl = options.fetchImpl ?? fetch;

      // KTD4: compose the genre surface from the dispatch payload — fresh
      // every turn, no skill or workspace re-materialization. Defensive by
      // construction: ANY failure here degrades to the core-4 fallback
      // rather than dropping the whole emit_document tool for the turn.
      let plates: readonly DocumentPlateSummary[];
      try {
        const normalized = normalizeDocumentPlates(config?.documentPlates);
        if (!normalized) {
          console.log(
            JSON.stringify({
              event: "document_plates_missing_from_payload",
              tenantId,
              threadId,
              fieldPresent: config?.documentPlates !== undefined,
            }),
          );
        }
        plates = normalized ?? FALLBACK_PLATES;
      } catch {
        plates = FALLBACK_PLATES;
      }
      // THINK-183 KTD8 (R14 floor): each contract-bearing plate's line names
      // its enforced sections (expected heading titles) and declared analyses
      // (key + op + input-shape hint) — enough to author a contract-satisfying
      // emission first-pass. Full guidance arrives in rejection diagnostics.
      const genreLines = plates
        .map((p) => {
          let line = `\`${p.slug}\`${p.useFor ? ` — ${p.useFor}` : ""}`;
          if (p.sections?.length) {
            const parts = p.sections.map(
              (s) =>
                `"## ${s.title}"${s.tier === "required-if-material" ? " (waive via tw:waiver if data is unavailable)" : ""}`,
            );
            line += ` [required sections: ${parts.join(", ")}]`;
          }
          if (p.analyses?.length) {
            const parts = p.analyses.map(
              (a) =>
                `${a.key} (op ${a.op}${a.inputHint ? `: ${a.inputHint}` : ""})`,
            );
            line += ` [declared analyses — author a \`\`\`tw:analysis block with \`analysis: <key>\` plus raw inputs; the server computes: ${parts.join(", ")}]`;
          }
          return line;
        })
        .join("; ");
      const genreList = plates.map((p) => p.slug).join(", ");
      const anyContract = plates.some(
        (p) => p.sections?.length || p.analyses?.length,
      );

      const tool: ToolDefinition = {
        name: EMIT_DOCUMENT_TOOL_NAME,
        label: "Emit Document",
        description:
          `Save a document deliverable as a durable artifact. Genres available in this workspace: ${genreList}. ` +
          "You author MARKDOWN ONLY in digest_markdown — optional frontmatter (eyebrow, date, context), " +
          "## sections, GFM tables, and tw: component blocks (```tw:stats, ```tw:verdict-grid, ```tw:chart " +
          "with types bar|line|donut|stat-strip|sparkline|meter|funnel). The platform compiles the " +
          "beautiful house-style HTML render server-side, including chart SVG drawn from your data — " +
          "never write HTML or SVG yourself (raw HTML is stripped; external links become plain text). " +
          "Start the body at ## Summary (the platform renders the H1 from title). " +
          "Unknown components or malformed YAML reject with a diagnostic showing the corrected form. " +
          (anyContract
            ? "Some genres declare a content contract: author every required section as a ## heading with " +
              "its exact listed title, satisfy declared analyses with ```tw:analysis blocks (analysis: <key> " +
              "plus the op's raw inputs — the server computes the numbers), and when a required section's " +
              "data is genuinely unavailable, waive it explicitly with a ```tw:waiver block (section: <id>, " +
              "reason: <why>) instead of omitting it. "
            : "") +
          "Emitting again with the same document_id revises the document (always pass the document_id " +
          "returned by a prior call when revising). status 'final' pins an immutable version; drafts stay " +
          "editable. Never include secrets, tokens, or credentials.",
        parameters: Type.Object({
          genre: Type.String({
            description: `The document genre — pick by purpose. One of: ${genreLines}.`,
          }),
          title: Type.String({ description: "Document title (≤160 chars)." }),
          abstract: Type.String({
            description:
              "2-3 sentence abstract shown on the thread card and list surfaces.",
          }),
          digest_markdown: Type.String({
            description:
              "The document's full substance as markdown: optional frontmatter, ## sections, tables, and tw: component blocks. This is the canonical record AND the source the platform compiles the visual render from.",
          }),
          status: Type.Optional(
            Type.String({
              description:
                "'draft' (default) or 'final'. Finalizing pins an immutable, content-addressed version.",
            }),
          ),
          document_id: Type.Optional(
            Type.String({
              description:
                "Stable id for this document within the thread. REQUIRED when revising a previously emitted document — pass the value returned by the earlier call.",
            }),
          ),
          space_id: Type.Optional(
            Type.String({
              description:
                "Only with status 'final': assign the finalized document to this space (requires the acting user's membership).",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const typed = (params ?? {}) as Record<string, unknown>;
          const genre = asString(typed.genre).toLowerCase();
          const digestMarkdown =
            typeof typed.digest_markdown === "string"
              ? typed.digest_markdown
              : "";

          // Soft check only (R11): the server-side registry is the
          // validation authority; an unlisted-but-registered slug (e.g. a
          // plate created mid-session) must still succeed.
          if (!PLATE_SLUG_RE.test(genre)) {
            throw new Error(
              `emit_document genre must be a lowercase slug. Genres available: ${genreList}`,
            );
          }
          // Local fast-fail (same diagnostic shape the server returns) — saves
          // shipping an oversize body just to have DocSpector reject it.
          const digestBytes = byteLength(digestMarkdown);
          if (digestBytes > EMIT_DOCUMENT_DIGEST_MAX_BYTES) {
            return diagnosticsResult([
              {
                code: "SIZE_CEILING",
                message: `digest_markdown is ${digestBytes} bytes; the ceiling is ${EMIT_DOCUMENT_DIGEST_MAX_BYTES}. Condense the digest — it is a summary record, not a transcript.`,
                location: "digest_markdown",
              },
            ]);
          }

          const response = await fetchImpl(
            `${apiUrl}/api/threads/${threadId}/activity`,
            {
              method: "POST",
              headers: {
                Authorization: `Bearer ${apiSecret}`,
                "Content-Type": "application/json",
                "x-tenant-id": tenantId,
                "User-Agent": "Thinkwork-AgentCore-Pi/1.0",
              },
              body: JSON.stringify({
                thread_turn_id: threadTurnId,
                tenant_id: tenantId,
                thread_id: threadId,
                ...(agentId ? { agent_id: agentId } : {}),
                document: {
                  documentId: asString(typed.document_id) || undefined,
                  genre,
                  title: asString(typed.title),
                  abstract: asString(typed.abstract),
                  digestMarkdown,
                  status: asString(typed.status) || "draft",
                  spaceId: asString(typed.space_id) || undefined,
                },
              }),
            },
          );

          const body = (await response.json().catch(() => ({}))) as Record<
            string,
            unknown
          >;

          if (body.ok === true) {
            const status = asString(body.status) || "draft";
            const headVersion =
              typeof body.headVersion === "number" ? body.headVersion : 0;
            const warnings = Array.isArray(body.warnings)
              ? (body.warnings as Array<Record<string, unknown>>)
              : [];
            const warningText =
              warnings.length > 0
                ? ` Non-blocking authoring warnings (fix on the next revision):\n${warnings
                    .map((w) => `- [${w.code}] ${w.message}`)
                    .join("\n")}`
                : "";
            const text =
              `Document saved (${status}${status === "final" ? `, pinned version ${headVersion}` : ""}). ` +
              `document_id: ${asString(body.documentId)} — pass this document_id on every revision. ` +
              `The document card is visible in the thread.` +
              warningText;
            return {
              content: [{ type: "text", text }],
              details: {
                artifactId: body.artifactId,
                documentId: body.documentId,
                status,
                headVersion,
              },
            };
          }

          if (
            body.code === "PREFLIGHT_REJECTED" ||
            body.code === "COMPILE_REJECTED"
          ) {
            return diagnosticsResult(
              Array.isArray(body.diagnostics)
                ? (body.diagnostics as Array<Record<string, unknown>>)
                : [],
            );
          }
          if (body.code === "FORBIDDEN" || body.code === "CONFLICT") {
            return {
              content: [
                {
                  type: "text",
                  text: `emit_document was refused (${body.code}): ${asString(body.error)}`,
                },
              ],
              details: { code: body.code },
            };
          }

          throw new Error(
            `emit_document failed: HTTP ${response.status}${
              body.error ? `: ${asString(body.error)}` : ""
            }`,
          );
        },
      };

      pi.registerTool(tool);
    },
  });
}

function diagnosticsResult(diagnostics: Array<Record<string, unknown>>): {
  content: Array<{ type: "text"; text: string }>;
  details: Record<string, unknown>;
} {
  const lines = diagnostics.map(
    (d) => `- [${d.code}] ${d.location}: ${d.message}`,
  );
  const text =
    `The document was REJECTED by validation — nothing was saved. ` +
    `Fix every issue below and call emit_document again with the corrected markdown:\n${lines.join("\n")}`;
  return {
    content: [{ type: "text", text }],
    details: { code: "REJECTED", diagnostics },
  };
}
