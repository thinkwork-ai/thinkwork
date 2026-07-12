/**
 * Bedrock Knowledge Base document-projection memory-source adapter
 * (THINK-193 U7).
 *
 * Direction: INGESTION. Full documents remain in Bedrock KB — the verbatim
 * RAG store and the authoritative source. Hindsight receives a stable,
 * ontology-aligned CLAIM projection that supersedes/retracts as documents
 * change. This adapter never copies chunks into Hindsight and never
 * projects dossiers back into the KB.
 *
 * Acquisition is driven by the ThinkWork DOCUMENT MANIFEST
 * (knowledge_base_documents), not by listing S3/Bedrock live: the
 * knowledge-base-manager reconciles the manifest only AFTER a successful
 * Bedrock ingestion job, so the adapter only ever projects editions the KB
 * itself has indexed. The cursor walks (updated_at, id) over manifest rows
 * whose ingest_status is 'indexed'; the data_source_id partition lives
 * INSIDE the cursor (a rechunk recreates the Bedrock data source — a
 * cursor minted against the old data source resets rather than silently
 * skipping re-ingested editions).
 *
 * Identity:
 *   - source_binding_key convention: the knowledge_bases.id (one source
 *     config per KB).
 *   - sourceItemId  = the full S3 document_key.
 *   - sourceVersion = `edition#<n>#<contentHash12>` — a re-acquire of an
 *     unchanged edition dedupes as a visible 'seen' no-op.
 *   - projectionKey = `document:<sha256(document_key)16>`. The plan sketch
 *     said `document:<manifestRowId>`; the registry's projectionKeyFor
 *     receives only the sourceItemId, and the manifest row is 1:1 with
 *     (kb, data_source, document_key) anyway, so a deterministic hash of
 *     the document_key is the same stable identity — and the manager's
 *     deletion chain can recompute it without a join
 *     (kbDocumentProjectionKey below).
 *   - subjectKey    = `kb:document:<document_key>`.
 *
 * V1 format scope: text/markdown documents are parsed directly. PDF (and
 * every other binary format) records a visible DEFERRED run item with
 * reason 'pdf_requires_fidelity_probe' and advances past the document —
 * the plan gates PDF/multimodal parsing behind a deployed Bedrock Data
 * Automation fidelity probe (citations + deterministic source versions),
 * which is a follow-up, not a U7 dependency.
 *
 * Deletion: the adapter never deletes KB documents or S3 objects. When the
 * manager's reconciliation marks a manifest row 'deleting', the manager
 * enqueues the STANDARD Hindsight derivation retraction for the row's
 * projection key (kb-document-manifest.ts); manifest settlement to
 * 'absent_verified' is independent and gated on Bedrock reporting the
 * document absent AND a scoped Retrieve returning no hits.
 */

import { createHash } from "node:crypto";
import { and, asc, eq, gt, or } from "drizzle-orm";
import {
  knowledgeBaseDocuments,
  knowledgeBases,
} from "@thinkwork/database-pg/schema";
import { getConfig } from "@thinkwork/runtime-config";

import {
  computeContentHash,
  recordAcquiredPage,
  recordRunItem,
} from "../evidence.js";
import {
  CheckpointConflictError,
  ensureCheckpoint,
  getCheckpoint,
} from "../repository.js";
import { effectiveLimit } from "../acquire-helpers.js";
import type { ClaimUpsert } from "../claims.js";
import type {
  DbHandle,
  EvidenceTargetScope,
  EvidenceUpsert,
} from "../types.js";
import type {
  AdapterAcquireArgs,
  AdapterAcquireOutcome,
  MemorySourceAdapter,
} from "./registry.js";

const PARTITION_KEY = "documents";
/** Defaults/caps track BOUNDARY_SCHEMAS.bedrock_kb (policy.ts). */
const DEFAULT_MAX_DOCUMENTS = 25;
const MAX_DOCUMENTS_CEILING = 500;
/** Bounded document text kept in the normalized snapshot (~256KB). */
export const MAX_DOCUMENT_TEXT_BYTES = 256 * 1024;
const MAX_TITLE_CHARS = 300;
const MAX_CITATIONS = 50;
const MAX_POLICY_STATEMENTS = 20;
const MAX_STATEMENT_CHARS = 300;
const MAX_DOSSIER_CHARS = 16 * 1024;
const EXTRACTION_VERSION = "u7.1";

/** Directly parseable in V1; everything else defers to the fidelity probe. */
const TEXT_EXTENSIONS = new Set([".md", ".markdown", ".txt"]);

// ---------------------------------------------------------------------------
// Small pure helpers
// ---------------------------------------------------------------------------

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

function extensionOf(key: string): string {
  const base = key.slice(key.lastIndexOf("/") + 1);
  const dot = base.lastIndexOf(".");
  return dot >= 0 ? base.slice(dot).toLowerCase() : "";
}

/** True when the document is directly parseable text/markdown in V1. */
export function isTextDocumentKey(key: string): boolean {
  return TEXT_EXTENSIONS.has(extensionOf(key));
}

/** The visible defer reason for a V1-unsupported format. */
export function unsupportedFormatReason(key: string): string {
  return extensionOf(key) === ".pdf"
    ? "pdf_requires_fidelity_probe"
    : `format '${extensionOf(key) || "unknown"}' is not parsed in V1 (text/markdown only)`;
}

/** Flatten + bound hostile document text for a claim value: newlines
 * collapse, HTML comment delimiters are broken (provenance comments in the
 * claim projection cannot be terminated), and length is capped. */
function boundedInlineText(value: string, max: number): string {
  return value
    .replace(/\s*\r?\n\s*/g, " ")
    .replace(/<!--|-->/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, max)
    .trim();
}

function parseDateOrNull(value: unknown): Date | null {
  const raw = stringOrNull(value);
  if (!raw) return null;
  const parsed = new Date(raw);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

// ---------------------------------------------------------------------------
// Normalization (pure)
// ---------------------------------------------------------------------------

export interface KbDocumentFrontmatter {
  title: string | null;
  effectiveDate: string | null;
}

/**
 * PURE: minimal YAML-ish frontmatter scan for the two fields the ontology
 * cares about. Only a leading `---` block is considered; values are plain
 * scalars (quotes stripped). Anything else in the block is ignored.
 */
export function parseFrontmatter(text: string): {
  frontmatter: KbDocumentFrontmatter;
  body: string;
} {
  const empty: KbDocumentFrontmatter = { title: null, effectiveDate: null };
  const match = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?/.exec(text);
  if (!match) return { frontmatter: empty, body: text };
  const block = match[1]!;
  const scalar = (name: string): string | null => {
    const line = new RegExp(`^${name}\\s*:\\s*(.+)$`, "im").exec(block);
    if (!line) return null;
    return line[1]!.trim().replace(/^["']|["']$/g, "") || null;
  };
  return {
    frontmatter: {
      title: scalar("title"),
      effectiveDate: scalar("effective_date") ?? scalar("effectiveDate"),
    },
    body: text.slice(match[0].length),
  };
}

export interface NormalizedKbDocument {
  documentKey: string;
  edition: number;
  title: string;
  text: string;
  /** ISO frontmatter effective date, when derivable. */
  effectiveDate?: string;
  truncated?: boolean;
  /** Section refs derivable from markdown headings: heading text + the
   * 1-based line number in the normalized body. */
  citations: Array<{ heading: string; line: number }>;
  [key: string]: unknown;
}

/**
 * PURE: bounded, deterministic snapshot of one text/markdown document.
 * Title precedence: frontmatter `title` → first `# ` heading → the file
 * basename. Text is bounded at ~256KB with an explicit truncation flag;
 * heading-derived citations are captured before truncation so section refs
 * survive for the retrieval surface even when the tail is cut.
 */
export function normalizeKbDocument(args: {
  documentKey: string;
  edition: number;
  rawText: string;
}): NormalizedKbDocument {
  const { frontmatter, body } = parseFrontmatter(args.rawText);
  const trimmed = body.replace(/\r\n/g, "\n").trim();

  const lines = trimmed.split("\n");
  const citations: Array<{ heading: string; line: number }> = [];
  let firstHeading: string | null = null;
  for (const [index, line] of lines.entries()) {
    const heading = /^#{1,6}\s+(.+?)\s*$/.exec(line);
    if (!heading) continue;
    const text = boundedInlineText(heading[1]!, MAX_TITLE_CHARS);
    if (!text) continue;
    firstHeading ??= text;
    if (citations.length < MAX_CITATIONS) {
      citations.push({ heading: text, line: index + 1 });
    }
  }

  const basename = args.documentKey.slice(
    args.documentKey.lastIndexOf("/") + 1,
  );
  const title =
    (frontmatter.title
      ? boundedInlineText(frontmatter.title, MAX_TITLE_CHARS)
      : null) ??
    firstHeading ??
    basename;

  let text = trimmed;
  let truncated = false;
  while (Buffer.byteLength(text, "utf8") > MAX_DOCUMENT_TEXT_BYTES) {
    const overshoot = Math.max(
      1024,
      Buffer.byteLength(text, "utf8") - MAX_DOCUMENT_TEXT_BYTES,
    );
    text = text.slice(0, Math.max(0, text.length - overshoot));
    truncated = true;
  }
  if (truncated) text = `${text}\n\n[…truncated at 256KB]`;

  const out: NormalizedKbDocument = {
    documentKey: args.documentKey,
    edition: args.edition,
    title,
    text,
    citations,
  };
  const effective = parseDateOrNull(frontmatter.effectiveDate);
  if (effective) out.effectiveDate = effective.toISOString();
  if (truncated) out.truncated = true;
  return out;
}

// ---------------------------------------------------------------------------
// Identity (pure)
// ---------------------------------------------------------------------------

/** Stable projection key: one Hindsight document per KB document. Exported
 * standalone so the manager's deletion chain (kb-document-manifest.ts) can
 * recompute it from a manifest row without loading the adapter registry. */
export function kbDocumentProjectionKey(documentKey: string): string {
  return `document:${createHash("sha256").update(documentKey, "utf8").digest("hex").slice(0, 16)}`;
}

/** Claim-ledger subject key for a KB document. */
export function kbDocumentSubjectKey(documentKey: string): string {
  return `kb:document:${documentKey}`;
}

/** Content-sensitive evidence edition: manifest edition + snapshot hash. */
export function kbEvidenceVersionFor(
  edition: number,
  contentHash: string,
): string {
  return `edition#${edition}#${contentHash.slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Claim extraction (pure)
// ---------------------------------------------------------------------------

/** Sentences/bullets that read as policy/SOP statements. */
const POLICY_SIGNAL_RE =
  /\b(must(?: not)?|shall(?: not)?|required|prohibited|do not|never|always|is not permitted|are not permitted)\b/i;

/**
 * PURE: reduce a normalized KB document snapshot into document-scoped,
 * ontology-aligned claims. Document content is HOSTILE input: every value
 * is inline-flattened and bounded so document text cannot inject markdown
 * structure or break provenance comments in the claim projection.
 *
 *   - document.title            single-valued {text}
 *   - document.effective_date   single-valued {date} when derivable from
 *                               frontmatter
 *   - document.policy_statement multi-valued {text, section?} — bounded
 *                               count of bullet/imperative statements
 */
export function extractKbDocumentClaims(input: {
  snapshot: Record<string, unknown>;
  sourceItemId: string;
  targetScope: EvidenceTargetScope;
  targetId: string;
  extractionVersion?: string;
}): ClaimUpsert[] {
  const { snapshot } = input;
  const subjectKey = kbDocumentSubjectKey(input.sourceItemId);
  const extractionVersion = input.extractionVersion ?? EXTRACTION_VERSION;
  const effectiveFrom = parseDateOrNull(snapshot.effectiveDate);
  const claims: ClaimUpsert[] = [];

  const push = (
    ontologyPredicate: string,
    value: Record<string, unknown>,
  ): void => {
    if (Object.keys(value).length === 0) return;
    claims.push({
      subjectKey,
      subjectEntityType: "document",
      ontologyPredicate,
      value,
      valueHash: computeContentHash(value),
      effectiveFrom,
      extractionVersion,
    });
  };

  const title = stringOrNull(snapshot.title);
  if (title) {
    const text = boundedInlineText(title, MAX_TITLE_CHARS);
    if (text) push("document.title", { text });
  }

  if (effectiveFrom) {
    push("document.effective_date", { date: effectiveFrom.toISOString() });
  }

  const body = stringOrNull(snapshot.text);
  if (body) {
    let section: string | null = null;
    let emitted = 0;
    for (const rawLine of body.split("\n")) {
      if (emitted >= MAX_POLICY_STATEMENTS) break;
      const heading = /^#{1,6}\s+(.+?)\s*$/.exec(rawLine);
      if (heading) {
        section = boundedInlineText(heading[1]!, MAX_TITLE_CHARS) || null;
        continue;
      }
      const bullet = /^\s*(?:[-*+]|\d+[.)])\s+(.+)$/.exec(rawLine);
      const candidate = bullet ? bullet[1]! : rawLine;
      if (!candidate.trim()) continue;
      // Non-bullet prose must carry an explicit policy signal; bullets under
      // a section are treated as enumerated policy/SOP steps only when they
      // carry the signal too — plain content lists are not policy claims.
      if (!POLICY_SIGNAL_RE.test(candidate)) continue;
      const text = boundedInlineText(candidate, MAX_STATEMENT_CHARS);
      if (!text) continue;
      const value: Record<string, unknown> = { text };
      if (section) value.section = section;
      push("document.policy_statement", value);
      emitted += 1;
    }
  }

  return claims;
}

// ---------------------------------------------------------------------------
// Fallback dossier (pure)
// ---------------------------------------------------------------------------

/**
 * PURE: deterministic fallback projection when a document subject has no
 * claims. The body renders as a blockquote — an explicit untrusted-content
 * boundary (hostile markdown cannot mint top-level sections).
 */
export function buildKbDocumentDossier(snapshot: Record<string, unknown>): {
  title: string;
  markdown: string;
} {
  const title =
    (stringOrNull(snapshot.title)
      ? boundedInlineText(snapshot.title as string, MAX_TITLE_CHARS)
      : null) ??
    stringOrNull(snapshot.documentKey) ??
    "Knowledge Base document";
  const lines: string[] = [`# ${title}`];
  const key = stringOrNull(snapshot.documentKey);
  if (key) lines.push(`- Document: ${boundedInlineText(key, 512)}`);
  if (typeof snapshot.edition === "number") {
    lines.push(`- Edition: ${snapshot.edition}`);
  }
  const effective = stringOrNull(snapshot.effectiveDate);
  if (effective) lines.push(`- Effective: ${boundedInlineText(effective, 64)}`);
  const body = stringOrNull(snapshot.text);
  if (body) {
    const quoted = body
      .split(/\r?\n/)
      .map((line) => `> ${line}`)
      .join("\n");
    lines.push(`## Content\n${quoted}`);
  }
  if (snapshot.truncated === true) lines.push("_…truncated_");
  let markdown = lines.join("\n\n");
  if (markdown.length > MAX_DOSSIER_CHARS) {
    markdown = `${markdown.slice(0, MAX_DOSSIER_CHARS)}\n\n…truncated`;
  }
  return { title, markdown };
}

// ---------------------------------------------------------------------------
// Readiness
// ---------------------------------------------------------------------------

export interface BedrockKbClient {
  /** Internal knowledge_bases.id (== the source_binding_key). */
  knowledgeBaseId: string;
  awsKnowledgeBaseId: string;
  dataSourceId: string;
  /** Bounded S3 text fetch for one manifest document key. */
  fetchDocumentText: (key: string) => Promise<{
    text: string;
    etag: string | null;
  }>;
}

const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function normalizeEtag(etag: string | null | undefined): string | null {
  if (!etag) return null;
  return etag.replace(/"/g, "");
}

async function defaultFetchDocumentText(
  bucket: string,
  key: string,
): Promise<{ text: string; etag: string | null }> {
  const { S3Client, GetObjectCommand } = await import("@aws-sdk/client-s3");
  const s3 = new S3Client({
    region: process.env.AWS_REGION || "us-east-1",
  });
  const resp = await s3.send(
    new GetObjectCommand({
      Bucket: bucket,
      Key: key,
      // Bounded read: the snapshot keeps at most MAX_DOCUMENT_TEXT_BYTES;
      // fetch a small margin so the truncation marker is accurate.
      Range: `bytes=0-${MAX_DOCUMENT_TEXT_BYTES + 4096}`,
    }),
  );
  const text = (await resp.Body?.transformToString("utf-8")) ?? "";
  return { text, etag: normalizeEtag(resp.ETag) };
}

export async function checkBedrockKbReadiness(
  db: DbHandle,
  args: { tenantId: string; bindingKey: string },
): Promise<
  { ready: true; client: BedrockKbClient } | { ready: false; reason: string }
> {
  if (!UUID_RE.test(args.bindingKey)) {
    return {
      ready: false,
      reason: `bedrock_kb binding key "${args.bindingKey}" is not a knowledge base id — the source_binding_key must be the knowledge_bases.id`,
    };
  }
  const [kb] = await db
    .select()
    .from(knowledgeBases)
    .where(
      and(
        eq(knowledgeBases.id, args.bindingKey),
        eq(knowledgeBases.tenant_id, args.tenantId),
      ),
    )
    .limit(1);
  if (!kb) {
    return {
      ready: false,
      reason: `knowledge base ${args.bindingKey} does not exist in this tenant`,
    };
  }
  if (kb.status !== "active" || !kb.aws_kb_id || !kb.aws_data_source_id) {
    return {
      ready: false,
      reason: `knowledge base "${kb.slug}" is not active/provisioned (status '${kb.status}') — repair the KB before running document projection`,
    };
  }
  const [manifestRow] = await db
    .select({ id: knowledgeBaseDocuments.id })
    .from(knowledgeBaseDocuments)
    .where(eq(knowledgeBaseDocuments.knowledge_base_id, kb.id))
    .limit(1);
  if (!manifestRow) {
    return {
      ready: false,
      reason: `knowledge base "${kb.slug}" has no document manifest yet — run a knowledge-base sync first (the manager reconciles the manifest after successful Bedrock ingestion)`,
    };
  }
  const bucket = getConfig("WORKSPACE_BUCKET", "");
  if (!bucket) {
    return { ready: false, reason: "WORKSPACE_BUCKET is not configured" };
  }
  return {
    ready: true,
    client: {
      knowledgeBaseId: kb.id,
      awsKnowledgeBaseId: kb.aws_kb_id,
      dataSourceId: kb.aws_data_source_id,
      fetchDocumentText: (key: string) => defaultFetchDocumentText(bucket, key),
    },
  };
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

interface ManifestCursor {
  dataSourceId: string;
  lastUpdatedAt: string | null;
  lastId: string | null;
}

/** PURE: decode the checkpoint cursor; a data-source mismatch (rechunk
 * recreated the Bedrock data source) resets to the partition start. */
export function manifestCursorFrom(
  cursor: Record<string, unknown> | null | undefined,
  dataSourceId: string,
): ManifestCursor {
  const fresh: ManifestCursor = {
    dataSourceId,
    lastUpdatedAt: null,
    lastId: null,
  };
  if (!cursor || cursor.dataSourceId !== dataSourceId) return fresh;
  return {
    dataSourceId,
    lastUpdatedAt:
      typeof cursor.lastUpdatedAt === "string" ? cursor.lastUpdatedAt : null,
    lastId: typeof cursor.lastId === "string" ? cursor.lastId : null,
  };
}

async function listChangedManifestRows(
  db: DbHandle,
  args: {
    knowledgeBaseId: string;
    dataSourceId: string;
    cursor: ManifestCursor;
    limit: number;
  },
): Promise<Array<typeof knowledgeBaseDocuments.$inferSelect>> {
  const base = and(
    eq(knowledgeBaseDocuments.knowledge_base_id, args.knowledgeBaseId),
    eq(knowledgeBaseDocuments.data_source_id, args.dataSourceId),
    eq(knowledgeBaseDocuments.ingest_status, "indexed"),
  );
  const after =
    args.cursor.lastUpdatedAt && args.cursor.lastId
      ? and(
          base,
          or(
            gt(
              knowledgeBaseDocuments.updated_at,
              new Date(args.cursor.lastUpdatedAt),
            ),
            and(
              eq(
                knowledgeBaseDocuments.updated_at,
                new Date(args.cursor.lastUpdatedAt),
              ),
              gt(knowledgeBaseDocuments.id, args.cursor.lastId),
            ),
          ),
        )
      : base;
  return await db
    .select()
    .from(knowledgeBaseDocuments)
    .where(after)
    .orderBy(
      asc(knowledgeBaseDocuments.updated_at),
      asc(knowledgeBaseDocuments.id),
    )
    .limit(args.limit);
}

async function runBedrockKbAcquire(
  args: AdapterAcquireArgs,
): Promise<AdapterAcquireOutcome> {
  const { db, processor, source, boundary, budget, options, override, counts } =
    args;
  const client = args.client as BedrockKbClient;

  // The effective KB set: this source is bound to exactly ONE KB (the
  // binding key); the boundary's knowledgeBaseIds must (still) include it.
  // The runner already proved boundary ⊆ grant — an omitted/empty value is
  // a visible no-op (nothing selected), never a widened default.
  const boundaryKbIds = Array.isArray(boundary.knowledgeBaseIds)
    ? (boundary.knowledgeBaseIds as string[])
    : [];
  if (!boundaryKbIds.includes(source.source_binding_key)) {
    return {
      ok: true,
      summary: {
        family: source.source_family,
        fetched: 0,
        note: `knowledge base ${source.source_binding_key} is not selected in the source boundary's knowledgeBaseIds — nothing to read`,
      },
    };
  }

  const maxDocuments = effectiveLimit(
    [
      boundary.maxDocuments,
      budget.maxDocuments,
      options.maxDocuments,
      override?.maxRecords,
    ],
    DEFAULT_MAX_DOCUMENTS,
    1,
    MAX_DOCUMENTS_CEILING,
  );

  let checkpoint = await ensureCheckpoint(db, {
    tenantId: processor.tenant_id,
    sourceConfigId: source.id,
    partitionKey: PARTITION_KEY,
  });
  let cursor = manifestCursorFrom(checkpoint.cursor, client.dataSourceId);

  const rows = await listChangedManifestRows(db, {
    knowledgeBaseId: client.knowledgeBaseId,
    dataSourceId: client.dataSourceId,
    cursor,
    limit: maxDocuments,
  });

  let fetched = 0;
  let deferred = 0;
  const failures: Array<{ documentKey: string; reason: string }> = [];

  for (const row of rows) {
    // Grant re-check before EVERY document read; a revoke between documents
    // stops the very next read (MemoryAuthorizationError propagates to the
    // runner; this document's checkpoint never advances).
    await args.revalidateGrant();

    const nextCursor = {
      dataSourceId: client.dataSourceId,
      lastUpdatedAt: row.updated_at.toISOString(),
      lastId: row.id,
    };
    const commitPage = async (items: EvidenceUpsert[]): Promise<boolean> => {
      try {
        const recorded = await recordAcquiredPage(db, {
          tenantId: processor.tenant_id,
          sourceConfigId: source.id,
          workflowRunId: args.workflowRunId,
          partitionKey: PARTITION_KEY,
          expectedCheckpointVersion: checkpoint.version,
          nextCursor,
          items,
          eraseFence: args.eraseFence,
        });
        counts.changed += recorded.changed.length;
        counts.seen += recorded.seen;
        checkpoint = recorded.checkpoint;
        return true;
      } catch (err) {
        if (err instanceof CheckpointConflictError) {
          // A concurrent worker advanced the checkpoint; its commit is
          // durable and evidence dedupes — re-read and continue.
          checkpoint =
            (await getCheckpoint(db, {
              sourceConfigId: source.id,
              partitionKey: PARTITION_KEY,
            })) ??
            (await ensureCheckpoint(db, {
              tenantId: processor.tenant_id,
              sourceConfigId: source.id,
              partitionKey: PARTITION_KEY,
            }));
          cursor = manifestCursorFrom(checkpoint.cursor, client.dataSourceId);
          return false;
        }
        throw err;
      }
    };

    if (!isTextDocumentKey(row.document_key)) {
      // V1 format gate: visible DEFERRED run item (PDF and other formats
      // wait for the Bedrock Data Automation fidelity probe follow-up),
      // manifest marked 'skipped', cursor advanced past the document. The
      // document itself stays fully retrievable in the KB.
      deferred += 1;
      const reason = unsupportedFormatReason(row.document_key);
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: args.workflowRunId,
        sourceConfigId: source.id,
        sourceItemId: row.document_key,
        stage: "acquire",
        result: "deferred",
        detail: { reason },
      });
      // NOTE: updated_at is deliberately NOT bumped — bumping it would
      // re-enter the cursor window and re-defer the same document forever.
      await db
        .update(knowledgeBaseDocuments)
        .set({ projection_status: "skipped", last_error: reason })
        .where(eq(knowledgeBaseDocuments.id, row.id));
      await commitPage([]);
      counts.pages += 1;
      continue;
    }

    let fetchedDoc: { text: string; etag: string | null };
    try {
      fetchedDoc = await client.fetchDocumentText(row.document_key);
    } catch (err) {
      // Visible failed run item, checkpoint untouched — the next run
      // resumes at this document. Stop rather than hammering S3.
      const reason = (err as Error)?.message ?? String(err);
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: args.workflowRunId,
        sourceConfigId: source.id,
        sourceItemId: row.document_key,
        stage: "acquire",
        result: "failed",
        detail: { reason: `document fetch failed: ${reason}`.slice(0, 500) },
      });
      await db
        .update(knowledgeBaseDocuments)
        .set({
          projection_status: "failed",
          last_error: reason.slice(0, 1000),
        })
        .where(eq(knowledgeBaseDocuments.id, row.id));
      return {
        ok: false,
        error: `document fetch failed for ${row.document_key}: ${reason}`.slice(
          0,
          500,
        ),
      };
    }
    counts.pages += 1;

    // Edition determinism: when the live object's etag no longer matches
    // the manifest edition (the file changed AFTER the last successful
    // sync), the KB index and this text disagree — defer visibly and let
    // the next sync mint the new edition rather than projecting text the
    // KB has not indexed.
    const manifestEtag = normalizeEtag(row.etag);
    if (manifestEtag && fetchedDoc.etag && fetchedDoc.etag !== manifestEtag) {
      deferred += 1;
      failures.push({
        documentKey: row.document_key,
        reason: "object changed since the last successful sync",
      });
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: args.workflowRunId,
        sourceConfigId: source.id,
        sourceItemId: row.document_key,
        stage: "acquire",
        result: "deferred",
        detail: {
          reason:
            "S3 object etag no longer matches the manifest edition — waiting for the next knowledge-base sync to reconcile",
        },
      });
      await commitPage([]);
      continue;
    }

    const snapshot = normalizeKbDocument({
      documentKey: row.document_key,
      edition: row.edition,
      rawText: fetchedDoc.text,
    });
    const contentHash = computeContentHash({
      documentKey: snapshot.documentKey,
      title: snapshot.title,
      text: snapshot.text,
    });
    const item: EvidenceUpsert = {
      sourceItemId: row.document_key,
      sourceVersion: kbEvidenceVersionFor(row.edition, contentHash),
      sourceTimestamp: row.effective_from ?? null,
      contentHash,
      normalizedSnapshot: snapshot,
      extractionRecipe: {
        source: "bedrock_kb",
        kind: "kb_document",
        recipeVersion: EXTRACTION_VERSION,
      },
      targetScope: processor.target_scope,
      targetId: processor.target_id,
    };

    if (await commitPage([item])) {
      fetched += 1;
      // Coarse operator signal only — memory_derivations is the
      // authoritative projection ledger; this marks "current edition
      // entered the projection pipeline" (the staleness-based project/
      // retain stages take it from here).
      await db
        .update(knowledgeBaseDocuments)
        .set({ projection_status: "projected", last_error: null })
        .where(eq(knowledgeBaseDocuments.id, row.id));
    }
  }

  return {
    ok: true,
    summary: {
      family: source.source_family,
      fetched,
      deferred,
      manifestRows: rows.length,
      checkpointVersion: checkpoint.version,
      ...(failures.length > 0 ? { failures: failures.slice(0, 20) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter registration
// ---------------------------------------------------------------------------

export const bedrockKbAdapter: MemorySourceAdapter = {
  family: "bedrock_kb",
  partitionKey: PARTITION_KEY,
  pathSegment: "bedrock-kb",
  // The KB is tenant infrastructure — no owner user needed to mint tokens.
  requiresOwnerUser: false,
  // KB documents are shared company memory — never a personal source.
  supportsPersonalScope: false,
  checkReadiness: (db, args) =>
    checkBedrockKbReadiness(db, {
      tenantId: args.tenantId,
      bindingKey: args.bindingKey,
    }),
  runAcquire: runBedrockKbAcquire,
  projectionKeyFor: kbDocumentProjectionKey,
  subjectKeyFor: kbDocumentSubjectKey,
  buildProjection: (snapshot) => buildKbDocumentDossier(snapshot),
  extractClaims: (input) => extractKbDocumentClaims(input),
  editionEffectiveFrom: (snapshot) => parseDateOrNull(snapshot.effectiveDate),
  focusLabelFor: (snapshot, sourceItemId) =>
    stringOrNull(snapshot?.title) ??
    sourceItemId.slice(sourceItemId.lastIndexOf("/") + 1),
};
