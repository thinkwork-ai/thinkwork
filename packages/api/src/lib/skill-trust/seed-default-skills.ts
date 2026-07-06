/**
 * Deploy-time default-skill publisher + trust gate (THINK-160).
 *
 * Shipping a skill in `packages/workspace-defaults/files/skills/<slug>/` seeds
 * it into every tenant's workspace-defaults *overlay* — but that alone never
 * makes it usable: the Skill Library and the runtime both read the tenant
 * *skill-catalog* (`tenants/<slug>/skill-catalog/<slug>/` + the `skill_catalog`
 * DB index), and the runtime only injects a catalog skill whose trust report
 * currently passes `isCurrentPassedSkillTrustReport`. Before this module every
 * tenant had to run the publish → run-skill-trust → sign runbook by hand.
 *
 * `seedDefaultCatalogSkills` closes that gap: for each default skill it
 * publishes the current source into the tenant catalog, runs SkillSpector,
 * applies a (platform-signed or approved-unverified) signature, persists the
 * passing report keyed to the content sha + pipeline version, and — for
 * `document-composer`-class skills — installs it into the tenant's platform
 * agent. It is idempotent (a byte-identical, already-trusted skill is skipped
 * with no timestamp churn) and fails loudly: if the trust gate does not pass,
 * the caller throws so the deploy fails rather than silently shipping a skill
 * the agent will free-hand around.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  NoSuchKey,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { agents, skillCatalog, tenants } from "@thinkwork/database-pg/schema";
import { loadDefaults } from "@thinkwork/workspace-defaults";
import {
  validateCatalogSkillFiles,
  type CatalogSkillArchiveFile,
} from "../catalog-skill-archive.js";
import { computeCatalogSkillSha } from "../catalog-skill-sha.js";
import { reindexCatalogSkill } from "../catalog-index.js";
import {
  CatalogInstallError,
  installCatalogSkill,
} from "../catalog-install.js";
import { reinstallCatalogSkill } from "../catalog-reinstall.js";
import { parseWiringMd } from "../wiring-md.js";
import { regenerateManifest } from "../workspace-manifest.js";
import {
  buildCatalogSkillTrustReport,
  type SkillTrustInputFile,
  type SkillTrustPipelineReport,
} from "./catalog-report.js";
import { fixSkillTrustEvidence } from "./evidence-fixes.js";
import { persistCatalogSkillTrustReport } from "./persist-catalog-trust.js";
import {
  isCurrentPassedSkillTrustReport,
  SKILL_TRUST_PIPELINE_VERSION,
} from "./runtime-gate.js";
import {
  createConfiguredSkillTrustSigner,
  signatureStatusForFiles,
} from "./signing.js";
import {
  runSkillSpectorForFiles,
  type SkillSpectorRunResult,
} from "./skillspector.js";

const SIGNATURE_PATH = "skill.oms.sig";

export interface DefaultCatalogSkill {
  slug: string;
  /**
   * `true` → also install into the tenant's platform agent so the runtime
   * injects it without an operator action (`document-composer`-class skills
   * that the platform is expected to use out of the box). `false` →
   * catalog-only: trusted and installable, but an operator opts the agent in.
   */
  autoGrant: boolean;
}

/**
 * The default skills auto-published into every tenant catalog. `artifact-builder`
 * (the document/artifact composer) auto-grants because the platform agent is
 * expected to render document plates without setup — the exact THINK-147 gap.
 * `automation-loop-designer` is catalog-only (operators opt an agent in).
 *
 * `skill-creator` is deliberately NOT here: it is a developer authoring tool,
 * not a per-tenant runtime capability, and it bundles Python runner scripts
 * that SkillSpector flags as blocking (verified live on dev — 4 critical/high
 * findings). Forcing it through the trust gate would fail every deploy. It
 * remains available via the workspace-defaults overlay for newly bootstrapped
 * agents and can be published manually if an operator wants it in the catalog.
 */
export const DEFAULT_CATALOG_SKILLS: DefaultCatalogSkill[] = [
  { slug: "artifact-builder", autoGrant: true },
  // THINK-177: document-composer must reseed whenever its plates change —
  // the DocSpector PLATE gate enforces the plate marker, so a tenant left on
  // stale plate content cannot emit documents at all. Auto-grant for the same
  // reason as artifact-builder: the platform agent must render document
  // plates out of the box.
  { slug: "document-composer", autoGrant: true },
  { slug: "automation-loop-designer", autoGrant: false },
];

export type DefaultSkillSeedOutcome =
  | "published"
  | "already-current"
  | "skipped-missing-source";

export interface DefaultSkillSeedResult {
  slug: string;
  outcome: DefaultSkillSeedOutcome;
  installed: boolean;
  signature: SkillTrustPipelineReport["evidence"]["signature"] | null;
}

export interface SeedDefaultCatalogSkillsSummary {
  tenantSlug: string;
  published: number;
  alreadyCurrent: number;
  installed: number;
  results: DefaultSkillSeedResult[];
}

export interface SeedDefaultCatalogSkillsInput {
  s3: S3Client;
  bucket: string;
  tenantId: string;
  tenantSlug: string;
  skills?: DefaultCatalogSkill[];
  now?: Date;
  logPrefix?: string;
}

/**
 * Load one default skill's source files from the inlined workspace-defaults
 * canon (`loadDefaults()` keys `skills/<slug>/...`), stripped to catalog
 * relative paths. Returns null when the slug ships no source (so the caller
 * can skip rather than fail — a stale slug in the list is not a deploy break).
 */
export function loadDefaultSkillSourceFiles(
  slug: string,
): CatalogSkillArchiveFile[] | null {
  const defaults = loadDefaults();
  const prefix = `skills/${slug}/`;
  const files: CatalogSkillArchiveFile[] = [];
  for (const [key, content] of Object.entries(defaults)) {
    if (!key.startsWith(prefix)) continue;
    const relativePath = key.slice(prefix.length);
    if (!relativePath) continue;
    files.push({ path: relativePath, content: Buffer.from(content, "utf8") });
  }
  return files.length > 0 ? files : null;
}

/** Build the signed, trusted final file set + report for a skill. No IO. */
export async function buildTrustedDefaultSkillArtifacts(input: {
  slug: string;
  sourceFiles: CatalogSkillArchiveFile[];
  now?: Date;
  /** Injectable for tests; defaults to running SkillSpector over the files. */
  scan?: SkillSpectorRunResult;
}): Promise<{
  finalFiles: SkillTrustInputFile[];
  report: SkillTrustPipelineReport;
  catalogContentSha: string;
}> {
  const validated = validateCatalogSkillFiles(input.sourceFiles);
  if (!validated.ok) {
    throw new Error(
      `default skill '${input.slug}' is not a valid Agent Skills directory: ${validated.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }
  if (validated.slug !== input.slug) {
    throw new Error(
      `default skill '${input.slug}' SKILL.md name is '${validated.slug}'`,
    );
  }

  const scan =
    input.scan ??
    (await runSkillSpectorForFiles({
      slug: input.slug,
      files: validated.files,
    }));
  const signer = createConfiguredSkillTrustSigner();
  const signed = await fixSkillTrustEvidence({
    slug: input.slug,
    files: validated.files,
    step: "signature",
    scanner: scan.scanner,
    scannerFindings: scan.findings,
    signer,
    now: input.now,
  });
  if (!signed.artifact) {
    throw new Error(
      `default skill '${input.slug}' could not be signed: ${signed.message}`,
    );
  }
  const finalFiles = replaceFile(validated.files, {
    path: signed.artifact.path,
    content: signed.artifact.content,
  });
  const report = buildCatalogSkillTrustReport({
    slug: input.slug,
    files: finalFiles,
    scanner: scan.scanner,
    scannerFindings: scan.findings,
    signature: await signatureStatusForFiles({
      slug: input.slug,
      files: finalFiles,
      signer,
    }),
    now: input.now,
  });
  assertReportRuntimeReady(input.slug, report);
  return {
    finalFiles,
    report,
    catalogContentSha: catalogShaFor(finalFiles),
  };
}

/** Publish + trust every default skill for one tenant. */
export async function seedDefaultCatalogSkills(
  input: SeedDefaultCatalogSkillsInput,
): Promise<SeedDefaultCatalogSkillsSummary> {
  const skills = input.skills ?? DEFAULT_CATALOG_SKILLS;
  const logPrefix = input.logPrefix ?? "[seed-skills]";
  const results: DefaultSkillSeedResult[] = [];

  for (const skill of skills) {
    const result = await seedOneDefaultSkill(input, skill, logPrefix);
    results.push(result);
  }

  return {
    tenantSlug: input.tenantSlug,
    published: results.filter((r) => r.outcome === "published").length,
    alreadyCurrent: results.filter((r) => r.outcome === "already-current")
      .length,
    installed: results.filter((r) => r.installed).length,
    results,
  };
}

async function seedOneDefaultSkill(
  input: SeedDefaultCatalogSkillsInput,
  skill: DefaultCatalogSkill,
  logPrefix: string,
): Promise<DefaultSkillSeedResult> {
  const { slug } = skill;
  const sourceFiles = loadDefaultSkillSourceFiles(slug);
  if (!sourceFiles) {
    console.log(
      `${logPrefix} ${input.tenantSlug}/${slug}: no default source shipped — skipped`,
    );
    return {
      slug,
      outcome: "skipped-missing-source",
      installed: false,
      signature: null,
    };
  }

  const catalogPrefix = `tenants/${input.tenantSlug}/skill-catalog/${slug}/`;
  const validated = validateCatalogSkillFiles(sourceFiles);
  if (!validated.ok) {
    throw new Error(
      `default skill '${slug}' is not a valid Agent Skills directory: ${validated.errors
        .map((error) => error.message)
        .join("; ")}`,
    );
  }

  // Idempotency: if the catalog already holds a byte-identical (non-signature)
  // copy AND that copy is signed AND the runtime gate already passes, do
  // nothing — re-signing would churn the unsigned-approval timestamp and the
  // content sha for no reason.
  const existing = await readCatalogFiles(
    input.s3,
    input.bucket,
    catalogPrefix,
  );
  if (
    existing &&
    nonSignatureFilesEqual(existing, validated.files) &&
    existing.some((file) => file.path === SIGNATURE_PATH) &&
    (await catalogGatePasses(input.tenantId, slug))
  ) {
    const installed = skill.autoGrant
      ? await ensurePlatformAgentInstall(input, slug, logPrefix)
      : false;
    console.log(
      `${logPrefix} ${input.tenantSlug}/${slug}: already current (trust gate passing)`,
    );
    return { slug, outcome: "already-current", installed, signature: null };
  }

  const { finalFiles, report, catalogContentSha } =
    await buildTrustedDefaultSkillArtifacts({
      slug,
      sourceFiles,
      now: input.now,
    });

  // Replace the catalog folder wholesale so orphaned files never skew the sha.
  if (existing) {
    for (const file of existing) {
      await input.s3.send(
        new DeleteObjectCommand({
          Bucket: input.bucket,
          Key: `${catalogPrefix}${file.path}`,
        }),
      );
    }
  }
  for (const file of finalFiles) {
    await input.s3.send(
      new PutObjectCommand({
        Bucket: input.bucket,
        Key: `${catalogPrefix}${file.path}`,
        Body: file.content,
        ContentType: contentTypeFor(file.path),
      }),
    );
  }

  // Reindex writes `content_sha` over the same S3 file set → equals
  // `catalogContentSha`; persist keys the report to it so the gate matches.
  await reindexCatalogSkill({
    tenantId: input.tenantId,
    tenantSlug: input.tenantSlug,
    slug,
    client: input.s3,
    bucket: input.bucket,
  });
  await persistCatalogSkillTrustReport({
    tenantId: input.tenantId,
    slug,
    report,
    catalogContentSha,
    signedByUserId: null,
  });

  // Fail the deploy loudly if — against expectation — the persisted row does
  // not actually pass the runtime gate.
  if (!(await catalogGatePasses(input.tenantId, slug))) {
    throw new Error(
      `default skill '${slug}' did not pass the runtime trust gate after publish for tenant '${input.tenantSlug}' — refusing to ship it untrusted`,
    );
  }

  const installed = skill.autoGrant
    ? await ensurePlatformAgentInstall(input, slug, logPrefix)
    : false;

  console.log(
    `${logPrefix} ${input.tenantSlug}/${slug}: published + trusted (signature=${report.evidence.signature})${installed ? " + installed on platform agent" : ""}`,
  );
  return {
    slug,
    outcome: "published",
    installed,
    signature: report.evidence.signature,
  };
}

/**
 * Install the skill into the tenant's platform-default agent workspace so the
 * runtime injects it. Idempotent: an already-installed skill is a no-op, and a
 * tenant without a platform agent is skipped (not a failure — some tenants are
 * pre-provisioning shells).
 */
async function ensurePlatformAgentInstall(
  input: SeedDefaultCatalogSkillsInput,
  slug: string,
  logPrefix: string,
): Promise<boolean> {
  const db = getDb();
  const [agent] = await db
    .select({
      slug: agents.slug,
      workspaceFolder: agents.workspace_folder_name,
    })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, input.tenantId),
        eq(agents.is_platform_default, true),
      ),
    )
    .limit(1);
  if (!agent?.slug) {
    console.log(
      `${logPrefix} ${input.tenantSlug}/${slug}: no platform default agent — skipped install`,
    );
    return false;
  }
  const workspaceFolder = agent.workspaceFolder ?? agent.slug;
  const targetPrefix = `tenants/${input.tenantSlug}/agents/${workspaceFolder}/`;

  const wiringChoice = await firstWiringChoice(
    input.s3,
    input.bucket,
    input.tenantSlug,
    slug,
  );

  try {
    await installCatalogSkill({
      s3: input.s3,
      bucket: input.bucket,
      tenantSlug: input.tenantSlug,
      targetPrefix,
      slug,
      wiringChoice,
      now: input.now,
    });
  } catch (err) {
    if (
      err instanceof CatalogInstallError &&
      err.code === "already_installed"
    ) {
      await rematerializeIfStale({
        reinstall: () =>
          reinstallCatalogSkill({
            s3: input.s3,
            bucket: input.bucket,
            tenantSlug: input.tenantSlug,
            targetPrefix,
            slug,
          }),
        regenerate: () =>
          regenerateManifest(input.bucket, input.tenantSlug, workspaceFolder),
        log: (line) =>
          console.log(`${logPrefix} ${input.tenantSlug}/${slug}: ${line}`),
      });
      return true;
    }
    throw err;
  }
  await regenerateManifest(input.bucket, input.tenantSlug, workspaceFolder);
  return true;
}

/**
 * Republishing the catalog is only half the update: the runtime reads the
 * MATERIALIZED workspace copy, and installCatalogSkill skips it when the
 * folder exists — the silent half-update behind the THINK-177 "default-skill
 * content updates never reach agents" incident (and its THINK-154 repeat).
 * Re-materialize on the already-installed path; reinstallCatalogSkill
 * self-detects the no-op case (installed ref sha === catalog sha) and writes
 * nothing when the copy is already current.
 */
async function rematerializeIfStale(deps: {
  reinstall: () => Promise<{ noop?: true; reinstalled_paths: string[] }>;
  regenerate: () => Promise<void>;
  log: (line: string) => void;
}): Promise<void> {
  const reinstall = await deps.reinstall();
  if (reinstall.noop) return;
  await deps.regenerate();
  deps.log(
    `workspace copy was stale — re-materialized ${reinstall.reinstalled_paths.length} files from the catalog`,
  );
}

async function firstWiringChoice(
  s3: S3Client,
  bucket: string,
  tenantSlug: string,
  slug: string,
): Promise<string> {
  const wiringMd = await readTextObject(
    s3,
    bucket,
    `tenants/${tenantSlug}/skill-catalog/${slug}/WIRING.md`,
  );
  const first = wiringMd ? parseWiringMd(wiringMd).suggestions[0] : undefined;
  if (!first) {
    throw new Error(
      `default skill '${slug}' has no WIRING.md suggestion for tenant '${tenantSlug}'`,
    );
  }
  return first.id;
}

// ── trust gate helpers ─────────────────────────────────────────────────────

function assertReportRuntimeReady(
  slug: string,
  report: SkillTrustPipelineReport,
): void {
  if (report.scanner.status === "not_configured") {
    throw new Error(
      `default skill '${slug}' cannot be trusted: SkillSpector is not configured (no skill-trust-runner). Set SKILL_TRUST_RUNNER_FUNCTION_NAME or deploy the runner.`,
    );
  }
  if (report.scanner.status === "failed") {
    throw new Error(
      `default skill '${slug}' SkillSpector scan failed: ${report.scanner.error ?? "unknown error"}`,
    );
  }
  if (report.status === "blocked") {
    throw new Error(
      `default skill '${slug}' has critical/high SkillSpector findings: ${report.summary}`,
    );
  }
  if (
    report.status !== "passed" ||
    report.spec.status !== "passed" ||
    report.scanner.status !== "completed" ||
    !(
      report.evidence.signature === "verified" ||
      report.evidence.signature === "approved_unverified"
    )
  ) {
    throw new Error(
      `default skill '${slug}' trust report is not runtime-ready (status=${report.status}, spec=${report.spec.status}, scanner=${report.scanner.status}, signature=${report.evidence.signature})`,
    );
  }
}

async function catalogGatePasses(
  tenantId: string,
  slug: string,
): Promise<boolean> {
  const db = getDb();
  const [row] = await db
    .select({
      slug: skillCatalog.slug,
      content_sha: skillCatalog.content_sha,
      trust_report: skillCatalog.trust_report,
      trust_report_content_sha: skillCatalog.trust_report_content_sha,
      trust_report_pipeline_version: skillCatalog.trust_report_pipeline_version,
    })
    .from(skillCatalog)
    .where(
      and(eq(skillCatalog.tenant_id, tenantId), eq(skillCatalog.slug, slug)),
    )
    .limit(1);
  if (!row) return false;
  return isCurrentPassedSkillTrustReport(row);
}

// ── S3 helpers ──────────────────────────────────────────────────────────────

async function readCatalogFiles(
  s3: S3Client,
  bucket: string,
  prefix: string,
): Promise<SkillTrustInputFile[] | null> {
  const keys: string[] = [];
  let continuationToken: string | undefined;
  do {
    const resp = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of resp.Contents ?? []) {
      if (!object.Key || !object.Key.startsWith(prefix)) continue;
      const relativePath = object.Key.slice(prefix.length);
      if (!relativePath || relativePath.endsWith("/")) continue;
      keys.push(relativePath);
    }
    continuationToken = resp.IsTruncated
      ? resp.NextContinuationToken
      : undefined;
  } while (continuationToken);
  if (keys.length === 0) return null;

  const files: SkillTrustInputFile[] = [];
  for (const relativePath of keys.sort()) {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: `${prefix}${relativePath}` }),
    );
    const bytes = await resp.Body?.transformToByteArray();
    files.push({ path: relativePath, content: Buffer.from(bytes ?? []) });
  }
  return files;
}

async function readTextObject(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    if (err instanceof NoSuchKey) return null;
    const name = (err as { name?: string } | null)?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw err;
  }
}

// ── pure helpers ────────────────────────────────────────────────────────────

function replaceFile(
  files: SkillTrustInputFile[],
  replacement: SkillTrustInputFile,
): SkillTrustInputFile[] {
  const lower = replacement.path.toLowerCase();
  return [
    ...files.filter((file) => file.path.toLowerCase() !== lower),
    replacement,
  ];
}

function nonSignatureFilesEqual(
  a: SkillTrustInputFile[],
  b: SkillTrustInputFile[],
): boolean {
  const strip = (files: SkillTrustInputFile[]) =>
    new Map(
      files
        .filter((file) => file.path !== SIGNATURE_PATH)
        .map((file) => [file.path, file.content] as const),
    );
  const mapA = strip(a);
  const mapB = strip(b);
  if (mapA.size !== mapB.size) return false;
  for (const [path, contentA] of mapA) {
    const contentB = mapB.get(path);
    if (!contentB || !contentA.equals(contentB)) return false;
  }
  return true;
}

function catalogShaFor(files: SkillTrustInputFile[]): string {
  return computeCatalogSkillSha(
    files.map((file) => ({ relativePath: file.path, content: file.content })),
  );
}

function contentTypeFor(path: string): string {
  const lower = path.toLowerCase();
  if (lower.endsWith(".md")) return "text/markdown; charset=utf-8";
  if (lower.endsWith(".json")) return "application/json; charset=utf-8";
  if (lower.endsWith(".py")) return "text/x-python; charset=utf-8";
  if (lower.endsWith(".txt")) return "text/plain; charset=utf-8";
  if (lower.endsWith(".html")) return "text/html; charset=utf-8";
  if (lower.endsWith(".css")) return "text/css; charset=utf-8";
  if (lower === SIGNATURE_PATH) return "application/json";
  if (lower.endsWith(".js") || lower.endsWith(".mjs")) {
    return "text/javascript; charset=utf-8";
  }
  return "application/octet-stream";
}

export const __test = {
  nonSignatureFilesEqual,
  replaceFile,
  catalogShaFor,
  assertReportRuntimeReady,
  rematerializeIfStale,
};
