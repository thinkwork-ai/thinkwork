/**
 * Firecrawl web-enrichment memory-source adapter (THINK-193 U5).
 *
 * Reuses the tenant `web-extract` builtin-tool binding (one Firecrawl
 * credential per tenant, source_binding_key "web-extract") for scheduled,
 * allowlisted URL snapshots with hash-based change detection — never the
 * provider's opaque monitor automation (Firecrawl KTD).
 *
 * Acquisition iterates the EFFECTIVE boundary URL list: exact URLs from the
 * saved source boundary only. Domain rules never expand to a crawl in V1 —
 * they only widen which exact config URLs a grant admits. Each scrape is
 * one "page": grant revalidation before the read, a post-redirect envelope
 * re-check on the FINAL url (a redirect must not widen scope, AE3), bounded
 * sanitized normalization, and a change-normalized content hash so cosmetic
 * churn dedupes at the evidence layer as a visible 'seen' no-op.
 *
 * Personal firecrawl is an explicit NON-GOAL in U5: the family stays in
 * SHARED_ONLY_SOURCE_FAMILIES (memory-stage-worker) and all evidence
 * targets shared banks.
 */

import { createHash } from "node:crypto";

import {
  loadTenantWebExtractConfig,
  runFirecrawlScrape,
} from "../../builtin-tools/web-extract.js";
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
import {
  isUrlWithinUrlSet,
  normalizeExactUrl,
  resolveExactUrls,
} from "../policy.js";
import { extractWebPageClaims } from "../claims.js";
import { normalizeWebMarkdownForComparison } from "../web-change.js";
import { effectiveLimit } from "../acquire-helpers.js";
import type { EvidenceUpsert } from "../types.js";
import type {
  AdapterAcquireArgs,
  AdapterAcquireOutcome,
  MemorySourceAdapter,
} from "./registry.js";

const PARTITION_KEY = "urls";
/** Defaults/caps track BOUNDARY_SCHEMAS.firecrawl.maxPages (policy.ts). */
const DEFAULT_MAX_PAGES = 5;
const MAX_PAGES_CEILING = 50;
const MAX_TITLE_CHARS = 300;
/** Snapshot budget mirrors the twenty adapter's ~64KB bound. */
const MAX_SNAPSHOT_BYTES = 64 * 1024;
const MAX_DOSSIER_CHARS = 16 * 1024;
const EXTRACTION_VERSION = "u5.1";

// ---------------------------------------------------------------------------
// Normalization (pure)
// ---------------------------------------------------------------------------

function stringOrNull(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value : null;
}

/**
 * Defensive active-content stripping: scraped markdown may embed raw HTML.
 * Remove script/style/iframe/object/embed blocks, event-handler attributes,
 * javascript:/vbscript:/data: URI targets, and HTML comments. The remaining
 * text is still HOSTILE input — downstream claim values inline-flatten it —
 * but it can no longer carry executable payloads into rendering surfaces.
 */
export function stripActiveContent(markdown: string): string {
  return (
    markdown
      .replace(
        /<(script|style|iframe|object|embed|form)\b[\s\S]*?<\/\1\s*>/gi,
        " ",
      )
      // Unclosed/self-closing variants of the same elements.
      .replace(/<(script|style|iframe|object|embed|form)\b[^>]*>/gi, " ")
      .replace(/<!--[\s\S]*?-->/g, " ")
      .replace(/\son\w+\s*=\s*("[^"]*"|'[^']*'|[^\s>]+)/gi, " ")
      .replace(/(javascript|vbscript|data)\s*:/gi, "blocked:")
  );
}

export interface NormalizedWebPage {
  requestedUrl: string;
  finalUrl: string;
  title?: string;
  markdown: string;
  truncated?: boolean;
  [key: string]: unknown;
}

/**
 * PURE: bounded, sanitized snapshot of one scraped page. Deterministic for
 * identical inputs (no timestamps); ~64KB cap by truncating the markdown
 * tail with an explicit `truncated` flag.
 */
export function normalizeWebPage(args: {
  requestedUrl: string;
  finalUrl: string;
  title?: string | null;
  markdown: string | null;
}): NormalizedWebPage {
  const cleaned = stripActiveContent(args.markdown ?? "").trim();
  const out: NormalizedWebPage = {
    requestedUrl: args.requestedUrl,
    finalUrl: args.finalUrl,
    markdown: cleaned,
  };
  const title = stringOrNull(args.title ?? null);
  if (title) {
    out.title = title.replace(/\s+/g, " ").trim().slice(0, MAX_TITLE_CHARS);
  }
  let truncated = false;
  while (
    Buffer.byteLength(JSON.stringify(out), "utf8") > MAX_SNAPSHOT_BYTES &&
    out.markdown.length > 0
  ) {
    const overshoot = Math.max(
      1024,
      Buffer.byteLength(JSON.stringify(out), "utf8") - MAX_SNAPSHOT_BYTES,
    );
    out.markdown = out.markdown.slice(
      0,
      Math.max(0, out.markdown.length - overshoot),
    );
    truncated = true;
  }
  if (truncated) out.truncated = true;
  return out;
}

/** Stable projection key: one document per normalized URL. */
export function projectionKeyForUrl(normalizedUrl: string): string {
  return `url:${createHash("sha256").update(normalizedUrl, "utf8").digest("hex").slice(0, 16)}`;
}

/** Claim-ledger subject key for a page. */
export function subjectKeyForUrl(normalizedUrl: string): string {
  return `web:page:${normalizedUrl}`;
}

/**
 * CHANGE-NORMALIZED HASHING: the evidence content hash covers the FINAL
 * url, the title, and the change-normalized markdown — cosmetic churn
 * (dates/counters/whitespace) hashes identically, so a re-scrape dedupes
 * as a 'seen' no-op while the snapshot keeps the full sanitized markdown.
 */
export function webContentHashFor(snapshot: NormalizedWebPage): string {
  return computeContentHash({
    finalUrl: snapshot.finalUrl,
    title: snapshot.title ?? null,
    markdown: normalizeWebMarkdownForComparison(snapshot.markdown),
  });
}

/** Hash-only evidence edition (pages carry no trustworthy timestamp). */
export function webEvidenceVersionFor(contentHash: string): string {
  return `hash#${contentHash.slice(0, 12)}`;
}

// ---------------------------------------------------------------------------
// Fallback dossier (pure)
// ---------------------------------------------------------------------------

/**
 * PURE: deterministic fallback projection when a page subject has no
 * claims. The page body is rendered as a blockquote — an explicit
 * untrusted-content boundary: hostile markdown cannot mint top-level
 * headings/sections in the projected document.
 */
export function buildWebPageDossier(snapshot: Record<string, unknown>): {
  title: string;
  markdown: string;
} {
  const inline = (value: string): string =>
    value.replace(/\s*\r?\n\s*/g, " ").trim();
  const title = stringOrNull(snapshot.title)
    ? inline(snapshot.title as string)
    : (stringOrNull(snapshot.finalUrl) ??
      stringOrNull(snapshot.requestedUrl) ??
      "Web page");
  const lines: string[] = [`# ${title}`];
  const finalUrl = stringOrNull(snapshot.finalUrl);
  if (finalUrl) lines.push(`- URL: ${inline(finalUrl)}`);
  const body = stringOrNull(snapshot.markdown);
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

export interface FirecrawlClient {
  provider: "firecrawl";
  apiKey: string;
}

export async function checkFirecrawlReadiness(
  db: unknown,
  args: { tenantId: string; bindingKey: string },
): Promise<
  { ready: true; client: FirecrawlClient } | { ready: false; reason: string }
> {
  if (args.bindingKey !== "web-extract") {
    // Fail closed: the only governed binding is the tenant builtin tool.
    return {
      ready: false,
      reason: `unsupported firecrawl binding key "${args.bindingKey}" — expected "web-extract"`,
    };
  }
  const config = await loadTenantWebExtractConfig(args.tenantId);
  if (!config) {
    return {
      ready: false,
      reason:
        "the tenant web-extract builtin tool is not configured/enabled with a Firecrawl credential — configure it in operator settings before running web enrichment",
    };
  }
  return {
    ready: true,
    client: { provider: config.provider, apiKey: config.apiKey },
  };
}

// ---------------------------------------------------------------------------
// Acquisition
// ---------------------------------------------------------------------------

function cursorIndexFrom(
  cursor: Record<string, unknown> | null | undefined,
  listLength: number,
): number {
  const raw = cursor?.nextIndex;
  const n = typeof raw === "number" && Number.isInteger(raw) ? raw : 0;
  if (listLength <= 0) return 0;
  return ((n % listLength) + listLength) % listLength;
}

async function runFirecrawlAcquire(
  args: AdapterAcquireArgs,
): Promise<AdapterAcquireOutcome> {
  const { db, processor, source, boundary, budget, options, override, counts } =
    args;
  const client = args.client as FirecrawlClient;

  // EFFECTIVE URL list: exact URLs from the saved boundary only (already
  // proven within the grant envelope by the runner). Malformed values fail
  // closed here too.
  let urls: string[];
  try {
    urls = resolveExactUrls(
      Array.isArray(boundary.urls) ? (boundary.urls as string[]) : [],
    );
  } catch (err) {
    return {
      ok: false,
      error: `source ${source.id} has a malformed URL boundary: ${(err as Error).message}`,
    };
  }
  // The grant envelope the FINAL (post-redirect) url must stay inside.
  const grantUrlSet = Array.isArray(args.grantBoundary.urls)
    ? (args.grantBoundary.urls as string[])
    : [];

  const maxPages = effectiveLimit(
    [
      boundary.maxPages,
      budget.maxPages,
      options.maxPages,
      override?.maxRecords,
    ],
    DEFAULT_MAX_PAGES,
    1,
    MAX_PAGES_CEILING,
  );

  if (urls.length === 0) {
    // Visible no-op: nothing granted+configured to read.
    return {
      ok: true,
      summary: {
        family: source.source_family,
        fetched: 0,
        note: "no exact URLs configured in the source boundary — domain rules alone select nothing in V1",
      },
    };
  }

  let checkpoint = await ensureCheckpoint(db, {
    tenantId: processor.tenant_id,
    sourceConfigId: source.id,
    partitionKey: PARTITION_KEY,
  });
  const start = cursorIndexFrom(checkpoint.cursor, urls.length);
  const pages = Math.min(maxPages, urls.length);
  let fetched = 0;
  let rejected = 0;
  const failures: Array<{ url: string; reason: string }> = [];

  for (let i = 0; i < pages; i += 1) {
    const idx = (start + i) % urls.length;
    const url = urls[idx]!;
    // Codex U2 #2: grant re-check before EVERY provider read; a revoke
    // between pages stops the very next scrape (MemoryAuthorizationError
    // propagates to the runner; this page's checkpoint never advances).
    await args.revalidateGrant();

    let scraped;
    try {
      scraped = await runFirecrawlScrape({
        provider: client.provider,
        apiKey: client.apiKey,
        url,
      });
    } catch (err) {
      // 429 / timeout / provider error: VISIBLE failed run item, checkpoint
      // untouched — the next run resumes at this URL. Stop the loop rather
      // than hammering a rate-limited API with the remaining budget.
      const reason = (err as Error)?.message ?? String(err);
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: args.workflowRunId,
        sourceConfigId: source.id,
        sourceItemId: url,
        stage: "acquire",
        result: "failed",
        detail: { reason: `firecrawl scrape failed: ${reason}`.slice(0, 500) },
      });
      return {
        ok: false,
        error: `firecrawl scrape failed for ${url}: ${reason}`.slice(0, 500),
      };
    }
    counts.pages += 1;
    fetched += 1;

    // Redirect containment (AE3): the FINAL url must stay inside the
    // GRANTED envelope — a redirect must never widen scope. Rejection is a
    // visible failed run item; no evidence, checkpoint untouched for this
    // page (the loop continues with the remaining URLs).
    let finalUrl: string;
    try {
      finalUrl = normalizeExactUrl(scraped.url);
    } catch {
      finalUrl = "";
    }
    if (!finalUrl || !isUrlWithinUrlSet(finalUrl, grantUrlSet)) {
      rejected += 1;
      failures.push({
        url,
        reason: `final URL ${scraped.url} escaped the granted envelope`,
      });
      await recordRunItem(db, {
        tenantId: processor.tenant_id,
        workflowRunId: args.workflowRunId,
        sourceConfigId: source.id,
        sourceItemId: url,
        stage: "acquire",
        result: "failed",
        detail: {
          reason: `redirected to ${scraped.url}, which is outside the granted URL envelope — refusing to record the page`,
        },
      });
      continue;
    }

    const snapshot = normalizeWebPage({
      requestedUrl: url,
      finalUrl,
      title: scraped.title ?? null,
      markdown: scraped.markdown,
    });
    const contentHash = webContentHashFor(snapshot);
    const item: EvidenceUpsert = {
      sourceItemId: url,
      sourceVersion: webEvidenceVersionFor(contentHash),
      sourceTimestamp: null,
      contentHash,
      normalizedSnapshot: snapshot,
      extractionRecipe: {
        source: "firecrawl",
        kind: "web_page",
        recipeVersion: EXTRACTION_VERSION,
      },
      targetScope: processor.target_scope,
      targetId: processor.target_id,
    };

    try {
      const recorded = await recordAcquiredPage(db, {
        tenantId: processor.tenant_id,
        sourceConfigId: source.id,
        workflowRunId: args.workflowRunId,
        partitionKey: PARTITION_KEY,
        expectedCheckpointVersion: checkpoint.version,
        // Round-robin resume position: the next URL after this one. With
        // maxPages < urls.length, later runs continue where this one ended.
        nextCursor: { nextIndex: (idx + 1) % urls.length },
        items: [item],
        eraseFence: args.eraseFence,
      });
      counts.changed += recorded.changed.length;
      counts.seen += recorded.seen;
      checkpoint = recorded.checkpoint;
    } catch (err) {
      if (err instanceof CheckpointConflictError) {
        // A concurrent worker advanced the checkpoint; its commit is durable
        // and evidence dedupes — re-read the surviving cursor and continue.
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
        continue;
      }
      throw err;
    }
  }

  return {
    ok: true,
    summary: {
      family: source.source_family,
      fetched,
      rejected,
      urlCount: urls.length,
      checkpointVersion: checkpoint.version,
      ...(failures.length > 0 ? { failures: failures.slice(0, 20) } : {}),
    },
  };
}

// ---------------------------------------------------------------------------
// Adapter registration
// ---------------------------------------------------------------------------

export const firecrawlAdapter: MemorySourceAdapter = {
  family: "firecrawl",
  partitionKey: PARTITION_KEY,
  pathSegment: "firecrawl",
  // Credentials are tenant-level (web-extract builtin tool) — no owner
  // user needed to mint tokens.
  requiresOwnerUser: false,
  checkReadiness: (db, args) =>
    checkFirecrawlReadiness(db, {
      tenantId: args.tenantId,
      bindingKey: args.bindingKey,
    }),
  runAcquire: runFirecrawlAcquire,
  projectionKeyFor: projectionKeyForUrl,
  subjectKeyFor: subjectKeyForUrl,
  buildProjection: (snapshot) => buildWebPageDossier(snapshot),
  extractClaims: (input) => extractWebPageClaims(input),
  // No trustworthy provider timestamp on web pages.
  editionEffectiveFrom: () => null,
  focusLabelFor: (snapshot, sourceItemId) =>
    stringOrNull(snapshot?.title) ?? sourceItemId,
};
