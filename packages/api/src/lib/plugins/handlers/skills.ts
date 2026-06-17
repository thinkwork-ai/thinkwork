/**
 * Plugin skills component handler (plan 2026-06-12-001 U5).
 *
 * Provisioning, per bundled skill source:
 *
 *   1. Seed the bundled SKILL.md (+ supporting files) into the tenant
 *      skill catalog at `tenants/<tenant-slug>/skill-catalog/<slug>/`
 *      (overwrite — idempotent re-run). Slugs are plugin-namespaced
 *      (`lastmile--crm-basics`) and satisfy the catalog SLUG_RE.
 *   2. Generate a WIRING.md when the bundle doesn't ship one. The plugin
 *      manifest contract has no interactive wiring choices, so the
 *      generated file carries exactly one suggestion (id `default`) whose
 *      CONTEXT.md snippet points the agent at the skill folder — the
 *      minimal valid wiring for `installCatalogSkill`.
 *   3. Refresh the `skill_catalog` index row (best-effort — the S3 prefix
 *      is the source of truth; index failures log, never fail install).
 *   4. Repair missing tenant platform-agent workspace defaults in
 *      preserve-existing mode so legacy agents have root CONTEXT.md without
 *      clobbering operator-authored files.
 *   5. Drive the existing `installCatalogSkill` machinery into the tenant
 *      platform agent's workspace with `wiringChoice: 'default'`. A 409
 *      `already_installed` is treated as success (create-or-repair).
 *   6. Regenerate the workspace manifest so the runtime re-syncs.
 *
 * Teardown reverses: `uninstallCatalogSkill` from the workspace (removes
 * skills/<slug>/ + the CONTEXT.md snippet), then delete the seeded catalog
 * prefix objects and drop the index row.
 */

import {
  DeleteObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { eq } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import { tenants } from "@thinkwork/database-pg/schema";
import type {
  PluginSkillSource,
  SkillsComponent,
} from "@thinkwork/plugin-catalog";
import { db as defaultDb } from "../../../graphql/utils.js";
import {
  CatalogInstallError,
  extractBundledEvalCases,
  installCatalogSkill,
} from "../../catalog-install.js";
import { uninstallCatalogSkill } from "../../catalog-uninstall.js";
import { reindexCatalogSkill } from "../../catalog-index.js";
import { regenerateManifest } from "../../workspace-manifest.js";
import { resolveTenantPlatformAgent } from "../../agents/tenant-platform-agent.js";
import { bootstrapAgentWorkspace } from "../../workspace-bootstrap.js";
import { renderWiringMd } from "../../wiring-md.js";
import {
  archiveSkillDatasetIfExists,
  ensureSkillDatasetSeeded,
} from "../../evals/skill-dataset.js";
import { launchSkillEvalRun } from "../../evals/skill-eval-run.js";

type DbLike = typeof defaultDb;
type S3Like = Pick<S3Client, "send">;

export const PLUGIN_SKILL_WIRING_CHOICE = "default";

/** handler_ref shape recorded on `skills` component rows. */
export interface SkillsHandlerRef extends Record<string, unknown> {
  /** Seeded tenant catalog prefixes, one per bundled skill. */
  seededCatalogPrefixes: string[];
  /** Installed workspace folders (relative), one per bundled skill. */
  workspaceFolders: string[];
  /** Platform agent workspace the skills were materialized into. */
  agentSlug: string;
}

export interface SkillsHandlerDeps {
  db?: DbLike;
  s3?: S3Like;
  bucket?: string;
  install?: typeof installCatalogSkill;
  uninstall?: typeof uninstallCatalogSkill;
  reindex?: typeof reindexCatalogSkill;
  regenerate?: typeof regenerateManifest;
  resolvePlatformAgent?: typeof resolveTenantPlatformAgent;
  bootstrapWorkspace?: typeof bootstrapAgentWorkspace;
  /** Per-skill eval dataset sync (Skill Tests & Evals U2). Injectable so
   *  unit tests stay hermetic; defaults to the real seeder. */
  seedSkillEvalDataset?: typeof ensureSkillDatasetSeeded;
  archiveSkillEvalDataset?: typeof archiveSkillDatasetIfExists;
  /** Async scored-run launcher (Skill Tests & Evals U5). Injectable so
   *  unit tests never hit AWS; defaults to the real launcher. */
  launchSkillEvalRun?: typeof launchSkillEvalRun;
}

function workspaceBucket(explicit?: string): string {
  const bucket = explicit ?? (getConfig("WORKSPACE_BUCKET") || "");
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET not configured for plugin skills");
  }
  return bucket;
}

export function pluginSkillWiringMd(skill: PluginSkillSource): string {
  return renderWiringMd([
    {
      id: PLUGIN_SKILL_WIRING_CHOICE,
      title: "Default",
      description:
        "Default wiring installed automatically with the application plugin.",
      snippet: `- For tasks covered by the \`${skill.slug}\` skill, read skills/${skill.slug}/SKILL.md and follow it.\n`,
    },
  ]);
}

async function resolveTenantSlug(
  db: DbLike,
  tenantId: string,
): Promise<string> {
  const [row] = (await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId))
    .limit(1)) as { slug: string }[];
  if (!row?.slug) {
    throw new Error(
      `Tenant ${tenantId} not found while installing plugin skills`,
    );
  }
  return row.slug;
}

export async function provisionPluginSkillsComponent(args: {
  tenantId: string;
  component: SkillsComponent;
  deps?: SkillsHandlerDeps;
}): Promise<SkillsHandlerRef> {
  const deps = args.deps ?? {};
  const db = deps.db ?? defaultDb;
  const s3 = deps.s3 ?? defaultS3();
  const bucket = workspaceBucket(deps.bucket);
  const install = deps.install ?? installCatalogSkill;
  const reindex = deps.reindex ?? reindexCatalogSkill;
  const regenerate = deps.regenerate ?? regenerateManifest;
  const resolveAgent = deps.resolvePlatformAgent ?? resolveTenantPlatformAgent;
  const bootstrapWorkspace = deps.bootstrapWorkspace ?? bootstrapAgentWorkspace;
  const seedSkillEvalDataset =
    deps.seedSkillEvalDataset ?? ensureSkillDatasetSeeded;
  const launchEvalRun = deps.launchSkillEvalRun ?? launchSkillEvalRun;

  const tenantSlug = await resolveTenantSlug(db, args.tenantId);
  const agent = await resolveAgent(args.tenantId, db as never);
  if (!agent.slug) {
    throw new Error(
      `Platform agent for tenant ${args.tenantId} has no workspace slug`,
    );
  }
  const targetPrefix = `tenants/${tenantSlug}/agents/${agent.slug}/`;

  await bootstrapWorkspace(agent.id, { mode: "preserve-existing" });

  const seededCatalogPrefixes: string[] = [];
  const workspaceFolders: string[] = [];

  for (const skill of args.component.skills) {
    const catalogPrefix = `tenants/${tenantSlug}/skill-catalog/${skill.slug}/`;

    // 1. Seed (overwrite) the bundled sources into the tenant catalog.
    const files: { path: string; content: string }[] = [
      { path: "SKILL.md", content: skill.skillMd },
      ...(skill.supportingFiles ?? []),
    ];
    if (!files.some((file) => file.path === "WIRING.md")) {
      files.push({ path: "WIRING.md", content: pluginSkillWiringMd(skill) });
    }
    for (const file of files) {
      await s3.send(
        new PutObjectCommand({
          Bucket: bucket,
          Key: `${catalogPrefix}${file.path}`,
          Body: file.content,
          ContentType: file.path.endsWith(".md")
            ? "text/markdown; charset=utf-8"
            : "text/plain; charset=utf-8",
        }),
      );
    }
    seededCatalogPrefixes.push(catalogPrefix);

    // 2. Best-effort skill_catalog index refresh (S3 stays authoritative).
    try {
      await reindex({
        tenantId: args.tenantId,
        tenantSlug,
        slug: skill.slug,
        client: s3 as S3Client,
        bucket,
      });
    } catch (error) {
      console.warn(
        `[plugin-skills] catalog index refresh failed for ${skill.slug}:`,
        (error as Error).message,
      );
    }

    // 3. Materialize into the platform agent workspace (409-tolerant).
    try {
      await install({
        s3: s3 as S3Client,
        bucket,
        tenantSlug,
        targetPrefix,
        slug: skill.slug,
        wiringChoice: PLUGIN_SKILL_WIRING_CHOICE,
      });
    } catch (error) {
      if (
        error instanceof CatalogInstallError &&
        error.code === "already_installed"
      ) {
        // Re-drive/repair: the workspace copy exists — seeding above
        // refreshed the catalog source; treat as success.
      } else {
        throw error;
      }
    }
    workspaceFolders.push(`skills/${skill.slug}/`);

    // 4. Sync the skill's bundled eval cases into its per-skill eval
    //    dataset (Skill Tests & Evals U2). The bundled cases are among the
    //    files just seeded (convention: evals/*.json). Defensive — an eval
    //    seeding failure must never fail plugin provisioning.
    const evalCases = extractBundledEvalCases(
      files.map((f) => ({ relativePath: f.path, content: f.content })),
    );
    if (evalCases.length > 0) {
      try {
        const seed = await seedSkillEvalDataset(
          args.tenantId,
          skill.slug,
          evalCases,
        );
        // U5: fire the async scored run once the dataset is rated. The
        // launcher self-guards (never throws), but wrap defensively too —
        // an eval launch must never fail plugin provisioning.
        if (seed.action !== "skipped") {
          await launchEvalRun({
            tenantId: args.tenantId,
            skillSlug: skill.slug,
          });
        }
      } catch (error) {
        console.warn(
          `[plugin-skills] eval dataset sync/launch failed for ${skill.slug}:`,
          (error as Error).message,
        );
      }
    }
  }

  await regenerate(bucket, tenantSlug, agent.slug);

  return { seededCatalogPrefixes, workspaceFolders, agentSlug: agent.slug };
}

export async function teardownPluginSkillsComponent(args: {
  tenantId: string;
  component: SkillsComponent | null;
  handlerRef: Record<string, unknown>;
  deps?: SkillsHandlerDeps;
}): Promise<void> {
  const deps = args.deps ?? {};
  const db = deps.db ?? defaultDb;
  const s3 = deps.s3 ?? defaultS3();
  const bucket = workspaceBucket(deps.bucket);
  const uninstall = deps.uninstall ?? uninstallCatalogSkill;
  const reindex = deps.reindex ?? reindexCatalogSkill;
  const regenerate = deps.regenerate ?? regenerateManifest;
  const resolveAgent = deps.resolvePlatformAgent ?? resolveTenantPlatformAgent;
  const archiveSkillEvalDataset =
    deps.archiveSkillEvalDataset ?? archiveSkillDatasetIfExists;

  const tenantSlug = await resolveTenantSlug(db, args.tenantId);
  const agentSlug =
    typeof args.handlerRef.agentSlug === "string" && args.handlerRef.agentSlug
      ? args.handlerRef.agentSlug
      : (await resolveAgent(args.tenantId, db as never)).slug;
  const targetPrefix = agentSlug
    ? `tenants/${tenantSlug}/agents/${agentSlug}/`
    : null;

  // Slug inventory: prefer the recorded handler_ref (what was actually
  // provisioned); fall back to the manifest component for never-recorded
  // partial provisions.
  const slugs = new Set<string>();
  if (Array.isArray(args.handlerRef.workspaceFolders)) {
    for (const folder of args.handlerRef.workspaceFolders) {
      const match = /^skills\/([a-z0-9][a-z0-9-]*)\/$/.exec(String(folder));
      if (match) slugs.add(match[1]!);
    }
  }
  for (const skill of args.component?.skills ?? []) {
    slugs.add(skill.slug);
  }

  for (const slug of slugs) {
    // 1. Remove the workspace copy + CONTEXT.md snippet.
    if (targetPrefix) {
      await uninstall({ s3: s3 as S3Client, bucket, targetPrefix, slug });
    }

    // 2. Delete the seeded catalog prefix objects.
    const catalogPrefix = `tenants/${tenantSlug}/skill-catalog/${slug}/`;
    let continuationToken: string | undefined;
    do {
      const response = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: catalogPrefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (!object.Key) continue;
        await s3.send(
          new DeleteObjectCommand({ Bucket: bucket, Key: object.Key }),
        );
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);

    // 3. Drop the index row (reindex of an empty prefix deletes it).
    try {
      await reindex({
        tenantId: args.tenantId,
        tenantSlug,
        slug,
        client: s3 as S3Client,
        bucket,
      });
    } catch (error) {
      console.warn(
        `[plugin-skills] catalog index cleanup failed for ${slug}:`,
        (error as Error).message,
      );
    }

    // 4. Archive the skill's eval dataset (Skill Tests & Evals U2). The
    //    catalog prefix was fully deleted above, so the skill is gone —
    //    soft-archive (history intact). Defensive; never fails teardown.
    try {
      await archiveSkillEvalDataset(args.tenantId, slug);
    } catch (error) {
      console.warn(
        `[plugin-skills] eval dataset archive failed for ${slug}:`,
        (error as Error).message,
      );
    }
  }

  if (agentSlug) {
    await regenerate(bucket, tenantSlug, agentSlug);
  }
}

let s3Singleton: S3Client | null = null;
function defaultS3(): S3Like {
  if (!s3Singleton) {
    s3Singleton = new S3Client({
      region:
        process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
    });
  }
  return s3Singleton;
}
