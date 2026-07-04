/**
 * HTML Document Artifacts (THINK-147 U4): the `emit_document` tool.
 *
 * The agent-facing half of the document pipeline: it ships the dual-body
 * document (markdown digest + self-contained single-file HTML render) to the
 * chat-agent-activity endpoint's `document.emit` branch, which validates
 * (DocSpector), persists both bodies to S3, upserts the born-as-artifact row,
 * optionally pins-and-finalizes, and appends the compact thread card. Bodies
 * ride the ~6MB Lambda invoke — never `thread_turn_events` (R4).
 *
 * Preflight rejects come back on the same synchronous call and are returned
 * VERBATIM as the tool result so the model self-corrects in-turn (R7).
 *
 * Registration is unconditional (gated only on the standard wiring fields and
 * not eval_mode) — R6 is satisfied a fortiori with no new dispatch-payload
 * flag. The host MUST fold the tool name into the session allowlist via
 * `addExtension` or it registers but never reaches the model.
 */

import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";
import { defineExtension, type ThinkworkExtension } from "./define-extension.js";

export const EMIT_DOCUMENT_TOOL_NAME = "emit_document";

export const DOCUMENT_GENRES = [
  "ideation",
  "plan",
  "report",
  "brief",
] as const;

/**
 * Local fast-fail ceilings. Kept in sync with the server-side source of truth
 * in packages/api/src/lib/artifacts/document-preflight.ts (DocSpector) — the
 * server always re-checks; these only save a wasted round trip.
 */
export const EMIT_DOCUMENT_RENDER_MAX_BYTES = 256 * 1024;
export const EMIT_DOCUMENT_DIGEST_MAX_BYTES = 96 * 1024;

export interface DocumentComposerConfig {
  apiUrl?: string;
  apiSecret?: string;
  tenantId?: string;
  threadId?: string;
  threadTurnId?: string;
  agentId?: string;
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

      const tool: ToolDefinition = {
        name: EMIT_DOCUMENT_TOOL_NAME,
        label: "Emit Document",
        description:
          "Save a document deliverable (ideation, plan, report, or brief) as a durable artifact " +
          "with a beautiful single-file HTML render and a canonical markdown digest. The render " +
          "must be FULLY self-contained: inline CSS only, system font stacks, inline SVG, data: " +
          "URIs — no external URLs (they are rejected), no <script>, and it must style both " +
          "light and dark themes. The digest is a faithful markdown record of the document's " +
          "full substance. Emitting again with the same document_id revises the document " +
          "(always pass the document_id returned by a prior call when revising). " +
          "status 'final' pins an immutable version; drafts stay editable. " +
          "Never include secrets, tokens, or credentials in either body.",
        parameters: Type.Object({
          genre: Type.String({
            description: "One of: ideation, plan, report, brief.",
          }),
          title: Type.String({ description: "Document title (≤160 chars)." }),
          abstract: Type.String({
            description:
              "2-3 sentence abstract shown on the thread card and list surfaces.",
          }),
          digest_markdown: Type.String({
            description:
              "Canonical markdown digest of the document's full substance (agents and mobile read this body).",
          }),
          render_html: Type.String({
            description:
              "The complete self-contained single-file HTML document (human-facing render).",
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
          const renderHtml =
            typeof typed.render_html === "string" ? typed.render_html : "";
          const digestMarkdown =
            typeof typed.digest_markdown === "string"
              ? typed.digest_markdown
              : "";

          if (!(DOCUMENT_GENRES as readonly string[]).includes(genre)) {
            throw new Error(
              `emit_document genre must be one of: ${DOCUMENT_GENRES.join(", ")}`,
            );
          }
          // Local fast-fail (same diagnostic shape the server returns) — saves
          // shipping an oversize body just to have DocSpector reject it.
          const renderBytes = byteLength(renderHtml);
          if (renderBytes > EMIT_DOCUMENT_RENDER_MAX_BYTES) {
            return diagnosticsResult([
              {
                code: "SIZE_CEILING",
                message: `render_html is ${renderBytes} bytes; the ceiling is ${EMIT_DOCUMENT_RENDER_MAX_BYTES}. Tighten the document rather than splitting it.`,
                location: "render_html",
              },
            ]);
          }
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
                  renderHtml,
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
            const text =
              `Document saved (${status}${status === "final" ? `, pinned version ${headVersion}` : ""}). ` +
              `document_id: ${asString(body.documentId)} — pass this document_id on every revision. ` +
              `The document card is visible in the thread.`;
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

          if (body.code === "PREFLIGHT_REJECTED") {
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
    `The document was REJECTED by preflight validation — nothing was saved. ` +
    `Fix every issue below and call emit_document again with the corrected bodies:\n${lines.join("\n")}`;
  return {
    content: [{ type: "text", text }],
    details: { code: "PREFLIGHT_REJECTED", diagnostics },
  };
}
