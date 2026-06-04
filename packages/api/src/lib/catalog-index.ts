/**
 * Skill catalog index — derived per-tenant projection of the S3 skill catalog.
 *
 * S3 (`tenants/<slug>/skill-catalog/<slug>/`) stays the source of truth. This
 * module keeps the `skill_catalog` table in sync so the Skills settings list
 * reads one query instead of scanning S3 + reading every file per load
 * (plan 2026-06-04-002 U2).
 *
 * Design: the index logic is decoupled from S3 and Drizzle behind the
 * `CatalogReader` and `IndexStore` interfaces so it is unit-testable with
 * fakes. Production wiring uses `createS3CatalogReader` + `createDrizzleIndexStore`.
 *
 * Invariants honored here:
 *  - A reindex with no `SKILL.md` in the prefix SKIPS (leaves any prior row) —
 *    never writes a null-metadata row for a mid-upload / partial folder.
 *  - Each reindex's read→write runs under a per-(tenant, slug) advisory lock so
 *    concurrent same-slug reindexes serialize (no resurrected deleted rows,
 *    no lost updates across a put/delete interleave).
 *  - `content_sha` mirrors `computeCatalogSkillSha` but is display/freshness
 *    only — reinstall drift checks recompute from S3 and never read it.
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import {
  and,
  db,
  eq,
  lt,
  notInArray,
  skillCatalog,
  sql,
} from "../graphql/utils.js";
import {
  computeCatalogSkillSha,
  type CatalogSkillShaFile,
} from "./catalog-skill-sha.js";
import { parseSkillMdInternal } from "./skill-md-parser.js";

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** A row of the per-skill summary the list page renders. */
export interface SkillSummaryRow {
  slug: string;
  display_name: string | null;
  description: string | null;
  category: string | null;
  icon: string | null;
  tags: string[] | null;
  content_sha: string;
}

export type ReindexAction = "upserted" | "skipped" | "deleted";

export interface ReindexResult {
  slug: string;
  action: ReindexAction;
}

export interface RescanCounts {
  skillsInS3: number;
  rowsUpserted: number;
  rowsSkipped: number;
  rowsDeleted: number;
}

/**
 * Reads the catalog source (S3) for one tenant. Paths returned by
 * `listSkillFiles` / accepted by `readSkillFile` are relative to the skill
 * folder (e.g. `SKILL.md`, `reference/notes.md`).
 */
export interface CatalogReader {
  listSlugs(): Promise<string[]>;
  listSkillFiles(slug: string): Promise<string[]>;
  readSkillFile(slug: string, relPath: string): Promise<string | null>;
}

/** Write surface handed to the locked reindex callback. */
export interface SkillIndexWriter {
  upsert(row: SkillSummaryRow): Promise<void>;
  delete(): Promise<void>;
}

/** The index persistence surface (Drizzle in prod, a fake in tests). */
export interface IndexStore {
  /** Run `fn` under a per-(tenant, slug) lock so same-slug reindexes serialize. */
  withSkillLock<T>(
    tenantId: string,
    slug: string,
    fn: (writer: SkillIndexWriter) => Promise<T>,
  ): Promise<T>;
  listSlugs(tenantId: string): Promise<string[]>;
  listSkills(tenantId: string): Promise<SkillSummaryRow[]>;
  /**
   * Delete rows for this tenant whose slug is not in `keepSlugs` AND whose
   * `updated_at` predates `since` — so a row a concurrent write-through created
   * after the rescan started is not erased. Returns the number deleted.
   */
  sweepOrphans(
    tenantId: string,
    keepSlugs: string[],
    since: Date,
  ): Promise<number>;
  /** DB clock, captured once at rescan start for the orphan-sweep guard. */
  now(): Promise<Date>;
}

// ---------------------------------------------------------------------------
// Metadata extraction
// ---------------------------------------------------------------------------

function coerceString(v: unknown): string | null {
  return typeof v === "string" && v.length > 0 ? v : null;
}

function coerceStringArray(v: unknown): string[] | null {
  if (!Array.isArray(v)) return null;
  const out = v.filter((x): x is string => typeof x === "string");
  return out.length > 0 ? out : null;
}

/**
 * Pull display fields from a SKILL.md source via the lenient parser. `name` is
 * a kebab identifier, not a human label, so `display_name` falls back to null
 * (the list renders the slug) rather than to `name`.
 */
export function parseSkillDisplayMeta(
  skillMdSource: string,
  slug: string,
): Omit<SkillSummaryRow, "slug" | "content_sha"> {
  const result = parseSkillMdInternal(skillMdSource, `${slug}/SKILL.md`);
  const data = result.valid ? result.parsed.data : {};
  return {
    display_name: coerceString(data.display_name),
    description: coerceString(data.description),
    category: coerceString(data.category),
    icon: coerceString(data.icon),
    tags: coerceStringArray(data.tags),
  };
}

/**
 * Determine what the index should hold for one slug, reading the catalog
 * source. Returns the intended action plus the row to write on "upsert".
 */
async function computeSkillRow(
  slug: string,
  reader: CatalogReader,
): Promise<
  | { action: "upsert"; row: SkillSummaryRow }
  | { action: "skip" }
  | { action: "delete" }
> {
  const files = await reader.listSkillFiles(slug);
  if (files.length === 0) return { action: "delete" };
  // Partial / mid-upload folder: files present but no SKILL.md yet. Leave any
  // prior row intact rather than persisting a null-metadata row.
  if (!files.includes("SKILL.md")) return { action: "skip" };

  const shaFiles: CatalogSkillShaFile[] = await Promise.all(
    files.map(async (relativePath) => ({
      relativePath,
      content: (await reader.readSkillFile(slug, relativePath)) ?? "",
    })),
  );
  const content_sha = computeCatalogSkillSha(shaFiles);
  const skillMd =
    shaFiles.find((f) => f.relativePath === "SKILL.md")?.content ?? "";
  const skillMdText =
    typeof skillMd === "string"
      ? skillMd
      : Buffer.from(skillMd).toString("utf8");
  const meta = parseSkillDisplayMeta(skillMdText, slug);
  return { action: "upsert", row: { slug, ...meta, content_sha } };
}

// ---------------------------------------------------------------------------
// Core operations
// ---------------------------------------------------------------------------

/**
 * Re-index one skill from the catalog source under a per-slug lock. The read
 * runs inside the lock so a concurrent delete cannot resurrect a row.
 */
export async function reindexSkill(
  tenantId: string,
  slug: string,
  reader: CatalogReader,
  store: IndexStore,
): Promise<ReindexResult> {
  return store.withSkillLock(tenantId, slug, async (writer) => {
    const computed = await computeSkillRow(slug, reader);
    if (computed.action === "delete") {
      await writer.delete();
      return { slug, action: "deleted" };
    }
    if (computed.action === "skip") {
      return { slug, action: "skipped" };
    }
    await writer.upsert(computed.row);
    return { slug, action: "upserted" };
  });
}

/**
 * Reconstruct a tenant's index from the catalog source. Reindexes every skill
 * present in S3, then sweeps orphan rows (slugs gone from S3, untouched since
 * the rescan started). `dryRun` computes the would-be counts without writing.
 */
export async function rescanTenant(
  tenantId: string,
  reader: CatalogReader,
  store: IndexStore,
  opts: { dryRun?: boolean } = {},
): Promise<RescanCounts> {
  const dryRun = opts.dryRun ?? false;
  const slugs = await reader.listSlugs();
  const since = dryRun ? null : await store.now();

  let rowsUpserted = 0;
  let rowsSkipped = 0;
  for (const slug of slugs) {
    if (dryRun) {
      const computed = await computeSkillRow(slug, reader);
      if (computed.action === "upsert") rowsUpserted++;
      else if (computed.action === "skip") rowsSkipped++;
      continue;
    }
    const result = await reindexSkill(tenantId, slug, reader, store);
    if (result.action === "upserted") rowsUpserted++;
    else if (result.action === "skipped") rowsSkipped++;
  }

  let rowsDeleted: number;
  if (dryRun) {
    const indexed = await store.listSlugs(tenantId);
    const keep = new Set(slugs);
    rowsDeleted = indexed.filter((s) => !keep.has(s)).length;
  } else {
    rowsDeleted = await store.sweepOrphans(tenantId, slugs, since as Date);
  }

  return { skillsInS3: slugs.length, rowsUpserted, rowsSkipped, rowsDeleted };
}

/** Read the per-skill summary rows for a tenant (the list page's hot path). */
export async function listIndexedSkills(
  tenantId: string,
  store: IndexStore = createDrizzleIndexStore(),
): Promise<SkillSummaryRow[]> {
  return store.listSkills(tenantId);
}

// ---------------------------------------------------------------------------
// Production wiring — S3 reader
// ---------------------------------------------------------------------------

const CATALOG_ARTIFACT_FILES = new Set(["manifest.json", "_defaults_version"]);

/**
 * A CatalogReader backed by the tenant's S3 skill-catalog prefix. Mirrors the
 * filtering of `listPrefix` in workspace-files.ts (skips operational artifacts)
 * so the computed SHA tracks the existing catalog-list path.
 */
export function createS3CatalogReader(opts: {
  client: S3Client;
  bucket: string;
  tenantSlug: string;
}): CatalogReader {
  const { client, bucket, tenantSlug } = opts;
  const base = `tenants/${tenantSlug}/skill-catalog/`;

  async function listRelative(prefix: string): Promise<string[]> {
    const rels: string[] = [];
    let continuationToken: string | undefined;
    do {
      const resp = await client.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (!obj.Key || !obj.Key.startsWith(prefix)) continue;
        const rel = obj.Key.slice(prefix.length);
        if (!rel || rel.endsWith("/")) continue;
        if (CATALOG_ARTIFACT_FILES.has(rel)) continue;
        rels.push(rel);
      }
      continuationToken = resp.IsTruncated
        ? resp.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return rels;
  }

  return {
    async listSlugs() {
      const rels = await listRelative(base);
      const slugs = new Set<string>();
      for (const rel of rels) {
        const seg = rel.split("/")[0];
        if (seg) slugs.add(seg);
      }
      return [...slugs];
    },
    async listSkillFiles(slug) {
      return listRelative(`${base}${slug}/`);
    },
    async readSkillFile(slug, relPath) {
      try {
        const resp = await client.send(
          new GetObjectCommand({
            Bucket: bucket,
            Key: `${base}${slug}/${relPath}`,
          }),
        );
        return (await resp.Body?.transformToString()) ?? null;
      } catch (e) {
        const name = (e as { name?: string }).name;
        const status = (e as { $metadata?: { httpStatusCode?: number } })
          .$metadata?.httpStatusCode;
        if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
          return null;
        }
        throw e;
      }
    },
  };
}

// ---------------------------------------------------------------------------
// Production wiring — Drizzle store
// ---------------------------------------------------------------------------

export function createDrizzleIndexStore(): IndexStore {
  return {
    async withSkillLock(tenantId, slug, fn) {
      return db.transaction(async (tx) => {
        // Two-int advisory lock keyed on (tenant, slug); released at txn end.
        await tx.execute(
          sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${slug}))`,
        );
        const writer: SkillIndexWriter = {
          async upsert(row) {
            await tx
              .insert(skillCatalog)
              .values({
                tenant_id: tenantId,
                slug: row.slug,
                display_name: row.display_name,
                description: row.description,
                category: row.category,
                icon: row.icon,
                tags: row.tags,
                content_sha: row.content_sha,
              })
              .onConflictDoUpdate({
                target: [skillCatalog.tenant_id, skillCatalog.slug],
                set: {
                  display_name: row.display_name,
                  description: row.description,
                  category: row.category,
                  icon: row.icon,
                  tags: row.tags,
                  content_sha: row.content_sha,
                  updated_at: sql`now()`,
                },
              });
          },
          async delete() {
            await tx
              .delete(skillCatalog)
              .where(
                and(
                  eq(skillCatalog.tenant_id, tenantId),
                  eq(skillCatalog.slug, slug),
                ),
              );
          },
        };
        return fn(writer);
      });
    },
    async listSlugs(tenantId) {
      const rows = await db
        .select({ slug: skillCatalog.slug })
        .from(skillCatalog)
        .where(eq(skillCatalog.tenant_id, tenantId));
      return rows.map((r) => r.slug);
    },
    async listSkills(tenantId) {
      const rows = await db
        .select({
          slug: skillCatalog.slug,
          display_name: skillCatalog.display_name,
          description: skillCatalog.description,
          category: skillCatalog.category,
          icon: skillCatalog.icon,
          tags: skillCatalog.tags,
          content_sha: skillCatalog.content_sha,
        })
        .from(skillCatalog)
        .where(eq(skillCatalog.tenant_id, tenantId))
        .orderBy(skillCatalog.slug);
      return rows.map((r) => ({ ...r, tags: r.tags ?? null }));
    },
    async sweepOrphans(tenantId, keepSlugs, since) {
      const base = and(
        eq(skillCatalog.tenant_id, tenantId),
        lt(skillCatalog.updated_at, since),
      );
      const where =
        keepSlugs.length > 0
          ? and(base, notInArray(skillCatalog.slug, keepSlugs))
          : base;
      const deleted = await db
        .delete(skillCatalog)
        .where(where)
        .returning({ slug: skillCatalog.slug });
      return deleted.length;
    },
    async now() {
      const res = (await db.execute(sql`SELECT now() AS now`)) as unknown as
        | { rows?: Array<{ now: unknown }> }
        | Array<{ now: unknown }>;
      const rows = Array.isArray(res) ? res : (res.rows ?? []);
      return new Date(rows[0]?.now as string);
    },
  };
}

// ---------------------------------------------------------------------------
// Convenience wrappers for call sites (write-through, rebuild action)
// ---------------------------------------------------------------------------

/** Write-through entry point: re-index one slug after a catalog S3 mutation. */
export async function reindexCatalogSkill(opts: {
  tenantId: string;
  tenantSlug: string;
  slug: string;
  client: S3Client;
  bucket: string;
}): Promise<ReindexResult> {
  const reader = createS3CatalogReader({
    client: opts.client,
    bucket: opts.bucket,
    tenantSlug: opts.tenantSlug,
  });
  return reindexSkill(
    opts.tenantId,
    opts.slug,
    reader,
    createDrizzleIndexStore(),
  );
}

/** Rebuild/backfill entry point: reconcile a tenant's whole index from S3. */
export async function rebuildTenantCatalogIndex(opts: {
  tenantId: string;
  tenantSlug: string;
  client: S3Client;
  bucket: string;
  dryRun?: boolean;
}): Promise<RescanCounts> {
  const reader = createS3CatalogReader({
    client: opts.client,
    bucket: opts.bucket,
    tenantSlug: opts.tenantSlug,
  });
  return rescanTenant(opts.tenantId, reader, createDrizzleIndexStore(), {
    dryRun: opts.dryRun,
  });
}
