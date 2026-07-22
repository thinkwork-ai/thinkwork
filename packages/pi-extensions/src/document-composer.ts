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

import type {
  ExtensionContext,
  ToolDefinition,
} from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";
import {
  FALLBACK_PLATES,
  normalizeDocumentPlates,
  parseSourcesClaims,
  PLATE_SLUG_RE,
  toolNamesMatch,
  type DocumentPlateSummary,
} from "./document-plates.js";

// Re-exported for existing consumers — the canonical home moved to
// document-plates.ts so the system-prompt contract block shares one
// normalizer (plates provenance 2026-07).
export {
  FALLBACK_PLATES,
  normalizeDocumentPlates,
  type DocumentPlateSummary,
} from "./document-plates.js";

export const EMIT_DOCUMENT_TOOL_NAME = "emit_document";

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

/**
 * Tools ACTUALLY invoked this turn, from the session tree (plates provenance
 * 2026-07): assistant `toolCall` content items plus `toolResult` messages on
 * the current branch. Returns null when the context/sessionManager is
 * unavailable (test harnesses, older hosts) — callers skip the cross-check
 * gracefully rather than blocking the emission.
 */
export function collectInvokedToolNames(
  ctx: ExtensionContext | undefined,
): string[] | null {
  const sessionManager = ctx?.sessionManager;
  if (!sessionManager) return null;
  let entries: unknown[];
  try {
    entries =
      typeof sessionManager.getBranch === "function"
        ? sessionManager.getBranch()
        : sessionManager.getEntries();
  } catch {
    return null;
  }
  if (!Array.isArray(entries)) return null;
  const names = new Set<string>();
  for (const entry of entries) {
    if (
      entry === null ||
      typeof entry !== "object" ||
      (entry as { type?: unknown }).type !== "message"
    ) {
      continue;
    }
    const message = (entry as { message?: unknown }).message;
    if (message === null || typeof message !== "object") continue;
    const record = message as Record<string, unknown>;
    if (record.role === "toolResult" && typeof record.toolName === "string") {
      names.add(record.toolName);
      continue;
    }
    if (record.role === "assistant" && Array.isArray(record.content)) {
      for (const item of record.content) {
        if (
          item !== null &&
          typeof item === "object" &&
          (item as { type?: unknown }).type === "toolCall" &&
          typeof (item as { name?: unknown }).name === "string"
        ) {
          names.add((item as { name: string }).name);
        }
      }
    }
  }
  return [...names];
}

/**
 * Ledger cross-check (plates provenance 2026-07): every tool a tw:sources
 * fence cites must match a tool actually invoked this turn. Returns the
 * REJECTED tool result to hand back for self-repair, or null when the claims
 * verify (or the check cannot run — absent ctx skips gracefully).
 */
function verifySourcesClaims(
  digestMarkdown: string,
  ctx: ExtensionContext | undefined,
): ReturnType<typeof diagnosticsResult> | null {
  const claimedTools = [
    ...new Set(parseSourcesClaims(digestMarkdown).flatMap((c) => c.tools)),
  ];
  if (claimedTools.length === 0) return null;
  let invoked: string[] | null;
  try {
    invoked = collectInvokedToolNames(ctx);
  } catch {
    invoked = null;
  }
  if (invoked === null) {
    console.log(
      JSON.stringify({
        event: "document_sources_crosscheck_skipped",
        reason: "session_manager_unavailable",
        claimedTools,
      }),
    );
    return null;
  }
  const unmatched = claimedTools.filter(
    (claim) => !invoked.some((name) => toolNamesMatch(claim, name)),
  );
  if (unmatched.length === 0) return null;
  const invokedList =
    invoked.filter((name) => name !== EMIT_DOCUMENT_TOOL_NAME).join(", ") ||
    "(none)";
  return diagnosticsResult([
    {
      code: "SOURCES_UNVERIFIED",
      message:
        `The tw:sources fences cite tools that were NOT invoked this turn: ${unmatched.join(", ")}. ` +
        `Tools actually invoked this turn: ${invokedList}. ` +
        "Only cite tools you actually called — fix each tw:sources fence to name the real tool that produced the section's data (or use `- none: <reason>` for narrative-only sections), then call emit_document again.",
      location: "tw:sources",
    },
  ]);
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
      // its enforced sections (expected heading titles + the operator's
      // section instructions + suggested visualizations) and declared
      // analyses. Framing matters (plates feedback 2026-07-21, round 2):
      // section instructions are a FLOOR — an earlier "follow each
      // section's instructions" framing made the model author ONLY the
      // manifest sections with minimal literal compliance, dropping the
      // charts/tables/extra sections it used to add. The wording below
      // states minimums and explicitly licenses enrichment.
      const genreLines = plates
        .map((p) => {
          let line = `\`${p.slug}\`${p.useFor ? ` — ${p.useFor}` : ""}`;
          if (p.authoringInstructions) {
            line += ` [operator authoring instructions for this genre: ${p.authoringInstructions}]`;
          }
          if (p.sections?.length) {
            const parts = p.sections.map((s) => {
              const waiveNote =
                s.tier === "required-if-material"
                  ? " (waive via tw:waiver if data is unavailable)"
                  : "";
              const suggested = (s.suggestedDirectives ?? [])
                .map((d) => (d.chartType ? `${d.kind} ${d.chartType}` : d.kind))
                .join(", ");
              const suggestedNote = suggested
                ? ` (suggested visualization: ${suggested})`
                : "";
              const guidanceNote = s.guidance
                ? `: must cover — ${s.guidance}`
                : "";
              return `"## ${s.title}"${waiveNote}${suggestedNote}${guidanceNote}`;
            });
            line += ` [sections this genre must include (a floor, NOT the full outline): ${parts.join("; ")}]`;
          }
          if (p.analyses?.length) {
            const parts = p.analyses.map(
              (a) =>
                `${a.key} (op ${a.op}${a.inputHint ? `: ${a.inputHint}` : ""})${a.guidance ? ` — ${a.guidance}` : ""}`,
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
          "PROVENANCE: every data-backed section must include a ```tw:sources fence inside the section " +
          "citing the exact tools + queries that produced its numbers — first line `section: <section-id>` " +
          "(the section's compiled heading id), then one `- tool: <tool-name> — <query/table/filter + row " +
          "count>` line per source. Purely narrative sections use `- none: <why no tool data backs this " +
          "section>` instead. Cited tools are VERIFIED against the tools you actually invoked this turn — " +
          "citing a tool you did not call rejects the emission. " +
          (anyContract
            ? "Some genres declare a content contract: author every required section as a ## heading with " +
              "its exact listed title, satisfy declared analyses with ```tw:analysis blocks (analysis: <key> " +
              "plus the op's raw inputs — the server computes the numbers), and when a required section's " +
              "data is genuinely unavailable, waive it explicitly with a ```tw:waiver block (section: <id>, " +
              "reason: <why>) instead of omitting it. " +
              "The contract is a FLOOR, not an outline: section instructions state what must appear, not " +
              "all that may. Beyond satisfying them, author the rich document the data deserves — add " +
              "further sections where the data supports them (aging breakdowns, risk callouts, a closing " +
              "summary), tables, and tw:stats / tw:chart visualizations wherever they make the evidence " +
              "clearer. A contract-minimum document with no visualizations is an underdelivery. "
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
        async execute(_toolCallId, params, _signal, _onUpdate, ctx) {
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

          // Provenance ledger cross-check (plates provenance 2026-07): a
          // tw:sources claim citing a tool that was never invoked this turn
          // is fabricated provenance — reject locally (no POST) so the model
          // self-repairs against the real ledger. Skips gracefully without a
          // session manager.
          const unverified = verifySourcesClaims(digestMarkdown, ctx);
          if (unverified) return unverified;

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
            // Plate identity + per-section outcomes from the emit response
            // (older servers omit them; degrade to the plain shape).
            const plate =
              body.plate && typeof body.plate === "object"
                ? (body.plate as { slug?: unknown; displayName?: unknown })
                : null;
            const plateName = plate ? asString(plate.displayName) : "";
            const sections = Array.isArray(body.sections)
              ? (body.sections as Array<Record<string, unknown>>)
              : [];
            const waived = sections.filter((s) => s.status === "waived");
            const waivedText =
              waived.length > 0
                ? ` Waived sections: ${waived.map((s) => asString(s.title)).join(", ")}.`
                : "";
            const text =
              `Document saved (${status}${status === "final" ? `, pinned version ${headVersion}` : ""}` +
              `${plateName ? `, plate: ${plateName}` : ""}). ` +
              `document_id: ${asString(body.documentId)} — pass this document_id on every revision. ` +
              `The document card is visible in the thread.` +
              waivedText +
              warningText;
            return {
              content: [{ type: "text", text }],
              details: {
                artifactId: body.artifactId,
                documentId: body.documentId,
                status,
                headVersion,
                genre,
                title: asString(typed.title),
                ...(plate ? { plate: body.plate } : {}),
                ...(sections.length > 0 ? { sections: body.sections } : {}),
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
