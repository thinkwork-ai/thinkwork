/**
 * Soft-layer node writer (Company Brain U8 — R11).
 *
 * The wiki-compile distillation output's Topic and Decision pages become
 * twin NODE TYPES with projected pages: this writer upserts them through
 * the twin write path (writer IAM, deterministic tenant-prefixed ids) with
 * an explicit `softLayer` provenance flag, so projected Topic/Decision
 * pages have nodes to project and conversation-derived knowledge stays
 * visibly distinct from source-backed fact (Key Decision: edges are
 * declared and deterministic; the soft layer joins by canonical id, it
 * never fabricates entity edges).
 */

import { and, eq, inArray } from "drizzle-orm";
import { wikiPages } from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../db.js";
import {
  createNeptuneClient,
  type NeptuneQueryClient,
} from "../entity-identity/graph-projection.js";

const SLUG_RE = /^[a-zA-Z][a-zA-Z0-9_-]{0,80}$/;

export interface SoftLayerPage {
  kind: "topic" | "decision";
  slug: string;
  title: string;
  summary?: string | null;
}

export function softLayerNodeId(
  tenantId: string,
  kind: "topic" | "decision",
  slug: string,
): string {
  return `t#${tenantId}#${kind}#${slug}`;
}

export interface SoftLayerWriteResult {
  written: number;
  skipped: number;
}

/**
 * Idempotent upsert (MERGE on ~id) of Topic/Decision nodes. Malformed
 * slugs are skipped, never inlined into query text. Never throws on a
 * per-node failure — the compile pipeline that calls this is best-effort
 * about its graph mirror (the compiled pages remain the fallback surface).
 */
export async function upsertSoftLayerNodes(args: {
  tenantId: string;
  pages: SoftLayerPage[];
  neptune?: NeptuneQueryClient;
  log?: Pick<Console, "warn">;
}): Promise<SoftLayerWriteResult> {
  const log = args.log ?? console;
  let neptune: NeptuneQueryClient;
  try {
    neptune = args.neptune ?? createNeptuneClient();
  } catch {
    return { written: 0, skipped: args.pages.length };
  }
  let written = 0;
  let skipped = 0;
  for (const page of args.pages) {
    if (
      (page.kind !== "topic" && page.kind !== "decision") ||
      !SLUG_RE.test(page.slug)
    ) {
      skipped += 1;
      continue;
    }
    const label = page.kind === "topic" ? "Topic" : "Decision";
    try {
      await neptune.execute(
        `MERGE (n:${label} {\`~id\`: $nodeId}) ` +
          "SET n.tenantId = $tenantId, n.slug = $slug, n.title = $title, " +
          "n.summary = $summary, n.softLayer = true",
        {
          nodeId: softLayerNodeId(args.tenantId, page.kind, page.slug),
          tenantId: args.tenantId,
          slug: page.slug,
          title: page.title,
          summary: page.summary ?? "",
        },
      );
      written += 1;
    } catch (err) {
      skipped += 1;
      log.warn("[twin:soft-layer] node upsert failed", {
        tenantId: args.tenantId,
        slug: page.slug,
        error: err instanceof Error ? err.message : String(err),
      });
    }
  }
  return { written, skipped };
}

/**
 * Post-compile sweep (the wiki-compile handler's best-effort hook): mirror
 * every active Topic/Decision page of the tenant into twin nodes. NEVER
 * throws — the compiled pages remain the authoritative fallback surface.
 */
export async function syncTenantSoftLayerNodes(args: {
  tenantId: string;
  db?: typeof defaultDb;
  neptune?: NeptuneQueryClient;
}): Promise<SoftLayerWriteResult> {
  try {
    const db = args.db ?? defaultDb;
    const rows = await db
      .select({
        type: wikiPages.type,
        slug: wikiPages.slug,
        title: wikiPages.title,
        summary: wikiPages.summary,
      })
      .from(wikiPages)
      .where(
        and(
          eq(wikiPages.tenant_id, args.tenantId),
          eq(wikiPages.status, "active"),
          inArray(wikiPages.type, ["topic", "decision"]),
        ),
      );
    return await upsertSoftLayerNodes({
      tenantId: args.tenantId,
      pages: rows.map((row) => ({
        kind: row.type as "topic" | "decision",
        slug: row.slug,
        title: row.title,
        summary: row.summary,
      })),
      neptune: args.neptune,
    });
  } catch (err) {
    console.warn("[twin:soft-layer] tenant sweep failed", {
      tenantId: args.tenantId,
      error: err instanceof Error ? err.message : String(err),
    });
    return { written: 0, skipped: 0 };
  }
}
