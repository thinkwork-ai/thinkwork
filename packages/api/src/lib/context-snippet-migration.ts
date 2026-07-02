/**
 * One-shot legacy CONTEXT.md snippet migration (Composer plan
 * 2026-07-02-001 U5; KTD-4).
 *
 * Until U5, `installCatalogSkill` appended the selected WIRING.md snippet
 * to the workspace's CONTEXT.md and `uninstallCatalogSkill` stripped it.
 * U5 retires that lifecycle: routing wiring is computed into the rendered
 * CONTEXT.md `## Routing` managed section at render time. This migration
 * removes the legacy install-time appends from workspace source
 * CONTEXT.md files so managed sections become the single source of
 * wiring text.
 *
 * Precision contract (KTD-4 — exact match, never fuzzy):
 *
 *   - Pass 1 (installed skills): each installed skill's
 *     `.catalog-ref.json` stores the appended snippet verbatim. Only that
 *     exact text is stripped. If the snippet is not found verbatim but
 *     the file still references the skill's folder, the operator edited
 *     it — the file is left untouched and the skill is REPORTED.
 *   - Pass 2 (orphans): uninstall used to delete `skills/<slug>/`
 *     (including `.catalog-ref.json`) but could leave the snippet behind
 *     (the drift class caught on dev 2026-07-02). Routing lines that
 *     reference a `skills/<slug>/` folder that no longer exists are
 *     stripped only when they match an exact reconstruction — a snippet
 *     from the tenant catalog's WIRING.md for that slug, or the plugin
 *     default snippet template. Anything unmatched is REPORTED and left
 *     untouched.
 *
 * The migration walks every workspace scope skills install into —
 * `tenants/<t>/agents/<f>/` and `tenants/<t>/spaces/<f>/` (both are
 * `installCatalogSkill` targets). A missing CONTEXT.md is tolerated.
 * Dry-run mode (the default) produces the identical report with ZERO
 * writes. Idempotent: a second apply run is a no-op.
 */

import {
  GetObjectCommand,
  ListObjectsV2Command,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { pathToFileURL } from "node:url";
import { getConfig } from "@thinkwork/runtime-config";
import { parseWiringMd } from "./wiring-md.js";

const REGION =
  process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1";

/** Matches `skills/<folder>/` references inside routing/markdown lines. */
const SKILL_FOLDER_REFERENCE_RE = /skills\/([a-z0-9][a-z0-9-]*)\//g;

/**
 * The default routing snippet shape used for plugin-installed skills
 * (`pluginSkillWiringMd` in plugins/handlers/skills.ts) and rendered by
 * the computed Routing section. Kept dependency-free here — the plugin
 * handler module drags the DB import graph into what must stay a plain
 * S3-walking script. Parity is pinned by a test.
 */
export function defaultSkillRoutingSnippet(slug: string): string {
  return `- For tasks covered by the \`${slug}\` skill, read skills/${slug}/SKILL.md and follow it.\n`;
}

// ---------------------------------------------------------------------------
// Store seam (S3 in production; in-memory fake in tests)
// ---------------------------------------------------------------------------

export interface SnippetMigrationStore {
  /** All object keys under a prefix. */
  listKeys(prefix: string): Promise<string[]>;
  /** Immediate child folders (`<prefix><name>/`) under a prefix. */
  listChildPrefixes(prefix: string): Promise<string[]>;
  /** Object text, or null when the key does not exist. */
  getText(key: string): Promise<string | null>;
  putText(key: string, content: string): Promise<void>;
}

export class S3SnippetMigrationStore implements SnippetMigrationStore {
  constructor(
    private readonly s3: S3Client,
    private readonly bucket: string,
  ) {}

  async listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let continuationToken: string | undefined;
    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          ContinuationToken: continuationToken,
        }),
      );
      for (const object of response.Contents ?? []) {
        if (object.Key?.startsWith(prefix) && object.Key !== prefix) {
          keys.push(object.Key);
        }
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return keys.sort();
  }

  async listChildPrefixes(prefix: string): Promise<string[]> {
    const prefixes = new Set<string>();
    let continuationToken: string | undefined;
    do {
      const response = await this.s3.send(
        new ListObjectsV2Command({
          Bucket: this.bucket,
          Prefix: prefix,
          Delimiter: "/",
          ContinuationToken: continuationToken,
        }),
      );
      for (const common of response.CommonPrefixes ?? []) {
        if (common.Prefix) prefixes.add(common.Prefix);
      }
      continuationToken = response.IsTruncated
        ? response.NextContinuationToken
        : undefined;
    } while (continuationToken);
    return [...prefixes].sort();
  }

  async getText(key: string): Promise<string | null> {
    try {
      const response = await this.s3.send(
        new GetObjectCommand({ Bucket: this.bucket, Key: key }),
      );
      return (await response.Body?.transformToString("utf-8")) ?? "";
    } catch (err) {
      const name = (err as { name?: string } | null)?.name;
      const status = (err as { $metadata?: { httpStatusCode?: number } } | null)
        ?.$metadata?.httpStatusCode;
      if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
        return null;
      }
      throw err;
    }
  }

  async putText(key: string, content: string): Promise<void> {
    await this.s3.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: content,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
  }
}

// ---------------------------------------------------------------------------
// Exact-strip primitive
// ---------------------------------------------------------------------------

/**
 * Remove ONE verbatim occurrence of `snippet` and collapse only the
 * junction it leaves behind (never whole-file whitespace cleanup —
 * operator prose outside the snippet boundary survives byte-for-byte).
 * Returns null when the snippet is not present verbatim.
 */
export function stripExactOccurrence(
  content: string,
  snippet: string,
): string | null {
  if (!snippet) return null;
  const idx = content.indexOf(snippet);
  if (idx === -1) return null;
  const before = content.slice(0, idx);
  const after = content.slice(idx + snippet.length);
  const beforeNl = /\n*$/.exec(before)![0];
  const afterNl = /^\n*/.exec(after)![0];
  const core = before.slice(0, before.length - beforeNl.length);
  const rest = after.slice(afterNl.length);
  if (!core && !rest) return "";
  if (!core) return rest;
  if (!rest) return `${core}\n`;
  const joiner = Math.max(beforeNl.length, afterNl.length) >= 2 ? "\n\n" : "\n";
  return `${core}${joiner}${rest}`;
}

function normalizeNewlines(value: string): string {
  return value.replace(/\r\n?/g, "\n");
}

function cleanSnippet(snippet: string): string {
  return normalizeNewlines(snippet).trimEnd();
}

function referencedSkillFolders(content: string): Set<string> {
  const folders = new Set<string>();
  for (const match of content.matchAll(SKILL_FOLDER_REFERENCE_RE)) {
    folders.add(match[1]!);
  }
  return folders;
}

function linesReferencingFolder(content: string, folder: string): string[] {
  return content
    .split("\n")
    .filter((line) => line.includes(`skills/${folder}/`));
}

// ---------------------------------------------------------------------------
// Per-workspace migration (pure over injected reads)
// ---------------------------------------------------------------------------

export interface WorkspaceSnippetMigrationReport {
  workspacePrefix: string;
  status: "changed" | "clean" | "no_context_md";
  /** Pass 1: installed-skill snippets stripped via exact `.catalog-ref.json` match. */
  strippedSnippets: string[];
  /** Pass 1: skills whose stored snippet is no longer verbatim — file left untouched, reported. */
  editedSnippets: string[];
  /** Pass 2: orphan slugs stripped via exact reconstruction. */
  strippedOrphans: string[];
  /** Pass 2: orphan routing lines that matched no exact reconstruction — left untouched. */
  unmatchedOrphanLines: { slug: string; line: string }[];
  /** True only in apply mode when CONTEXT.md was rewritten. */
  wrote: boolean;
}

export interface MigrateWorkspaceContextInput {
  workspacePrefix: string;
  tenantSlug: string;
  mode: "dry-run" | "apply";
}

async function readCatalogRefSnippets(
  store: SnippetMigrationStore,
  workspacePrefix: string,
): Promise<{
  installedFolders: Set<string>;
  refs: { folder: string; snippet: string }[];
}> {
  const keys = await store.listKeys(`${workspacePrefix}skills/`);
  const installedFolders = new Set<string>();
  const refKeys: { folder: string; key: string }[] = [];
  for (const key of keys) {
    const rel = key.slice(`${workspacePrefix}skills/`.length);
    const folder = rel.split("/")[0];
    if (!folder || !rel.includes("/")) continue;
    installedFolders.add(folder);
    if (rel === `${folder}/.catalog-ref.json`) {
      refKeys.push({ folder, key });
    }
  }
  const refs: { folder: string; snippet: string }[] = [];
  for (const refKey of refKeys) {
    const raw = await store.getText(refKey.key);
    if (raw === null) continue;
    try {
      const parsed = JSON.parse(raw) as { snippet?: unknown } | null;
      if (parsed && typeof parsed.snippet === "string" && parsed.snippet) {
        refs.push({ folder: refKey.folder, snippet: parsed.snippet });
      }
    } catch {
      // Unparseable ref: nothing verbatim to strip — skip (never fuzzy).
    }
  }
  return { installedFolders, refs };
}

async function orphanSnippetCandidates(
  store: SnippetMigrationStore,
  tenantSlug: string,
  slug: string,
): Promise<string[]> {
  const candidates: string[] = [];
  const wiringMd = await store.getText(
    `tenants/${tenantSlug}/skill-catalog/${slug}/WIRING.md`,
  );
  if (wiringMd !== null) {
    for (const suggestion of parseWiringMd(wiringMd).suggestions) {
      if (suggestion.snippet) candidates.push(suggestion.snippet);
    }
  }
  candidates.push(defaultSkillRoutingSnippet(slug));
  return candidates;
}

export async function migrateWorkspaceContext(
  store: SnippetMigrationStore,
  input: MigrateWorkspaceContextInput,
): Promise<WorkspaceSnippetMigrationReport> {
  const report: WorkspaceSnippetMigrationReport = {
    workspacePrefix: input.workspacePrefix,
    status: "clean",
    strippedSnippets: [],
    editedSnippets: [],
    strippedOrphans: [],
    unmatchedOrphanLines: [],
    wrote: false,
  };

  const contextKey = `${input.workspacePrefix}CONTEXT.md`;
  const raw = await store.getText(contextKey);
  if (raw === null) {
    report.status = "no_context_md";
    return report;
  }

  const { installedFolders, refs } = await readCatalogRefSnippets(
    store,
    input.workspacePrefix,
  );

  const normalized = normalizeNewlines(raw);
  let content = normalized;

  // Pass 1 — installed skills: strip the exact stored snippet.
  for (const ref of refs.sort((a, b) => a.folder.localeCompare(b.folder))) {
    const snippet = cleanSnippet(ref.snippet);
    let strippedAny = false;
    for (;;) {
      const next = stripExactOccurrence(content, snippet);
      if (next === null) break;
      content = next;
      strippedAny = true;
    }
    if (strippedAny) {
      report.strippedSnippets.push(ref.folder);
    } else if (linesReferencingFolder(content, ref.folder).length > 0) {
      // The snippet is gone but the folder is still referenced: the
      // operator edited the wiring text. Report; never fuzzy-strip.
      report.editedSnippets.push(ref.folder);
    }
  }

  // Pass 2 — orphans: routing lines referencing skills/<slug>/ folders
  // that no longer exist. Strip only exact reconstructions.
  const orphanSlugs = [...referencedSkillFolders(content)]
    .filter((folder) => !installedFolders.has(folder))
    .sort();
  for (const slug of orphanSlugs) {
    const candidates = await orphanSnippetCandidates(
      store,
      input.tenantSlug,
      slug,
    );
    let strippedAny = false;
    for (const candidate of candidates) {
      const snippet = cleanSnippet(candidate);
      for (;;) {
        const next = stripExactOccurrence(content, snippet);
        if (next === null) break;
        content = next;
        strippedAny = true;
      }
    }
    if (strippedAny) report.strippedOrphans.push(slug);
    for (const line of linesReferencingFolder(content, slug)) {
      report.unmatchedOrphanLines.push({ slug, line });
    }
  }

  // Write only when a strip occurred — a CRLF-only normalization diff is
  // NOT a reason to rewrite an operator file.
  const stripped =
    report.strippedSnippets.length > 0 || report.strippedOrphans.length > 0;
  if (stripped) {
    report.status = "changed";
    if (input.mode === "apply") {
      await store.putText(contextKey, content);
      report.wrote = true;
    }
  }
  return report;
}

// ---------------------------------------------------------------------------
// Full-bucket walk
// ---------------------------------------------------------------------------

export interface SnippetMigrationOptions {
  bucket?: string;
  mode?: "dry-run" | "apply";
  /** Restrict the walk to one tenant slug. */
  tenantSlug?: string;
  store?: SnippetMigrationStore;
}

export interface SnippetMigrationSummary {
  workspaces: number;
  changed: number;
  wrote: number;
  missingContextMd: number;
  snippetsStripped: number;
  orphansStripped: number;
  editedSkipped: number;
  unmatchedOrphanLines: number;
}

export interface SnippetMigrationResult {
  mode: "dry-run" | "apply";
  bucket: string;
  reports: WorkspaceSnippetMigrationReport[];
  summary: SnippetMigrationSummary;
}

const WORKSPACE_SCOPE_FOLDERS = ["agents", "spaces"] as const;

export async function runContextSnippetMigration(
  options: SnippetMigrationOptions = {},
): Promise<SnippetMigrationResult> {
  const mode = options.mode ?? "dry-run";
  const bucket = options.bucket ?? getConfig("WORKSPACE_BUCKET") ?? "";
  if (!bucket && !options.store) {
    throw new Error("WORKSPACE_BUCKET is required");
  }
  const store =
    options.store ??
    new S3SnippetMigrationStore(new S3Client({ region: REGION }), bucket);

  const tenantPrefixes = options.tenantSlug
    ? [`tenants/${options.tenantSlug}/`]
    : await store.listChildPrefixes("tenants/");

  const reports: WorkspaceSnippetMigrationReport[] = [];
  for (const tenantPrefix of tenantPrefixes) {
    const tenantSlug = tenantPrefix.split("/")[1]!;
    for (const scope of WORKSPACE_SCOPE_FOLDERS) {
      const workspacePrefixes = await store.listChildPrefixes(
        `${tenantPrefix}${scope}/`,
      );
      for (const workspacePrefix of workspacePrefixes) {
        reports.push(
          await migrateWorkspaceContext(store, {
            workspacePrefix,
            tenantSlug,
            mode,
          }),
        );
      }
    }
  }

  const summary: SnippetMigrationSummary = {
    workspaces: reports.length,
    changed: reports.filter((report) => report.status === "changed").length,
    wrote: reports.filter((report) => report.wrote).length,
    missingContextMd: reports.filter(
      (report) => report.status === "no_context_md",
    ).length,
    snippetsStripped: reports.reduce(
      (total, report) => total + report.strippedSnippets.length,
      0,
    ),
    orphansStripped: reports.reduce(
      (total, report) => total + report.strippedOrphans.length,
      0,
    ),
    editedSkipped: reports.reduce(
      (total, report) => total + report.editedSnippets.length,
      0,
    ),
    unmatchedOrphanLines: reports.reduce(
      (total, report) => total + report.unmatchedOrphanLines.length,
      0,
    ),
  };

  return { mode, bucket, reports, summary };
}

// ---------------------------------------------------------------------------
// CLI
// ---------------------------------------------------------------------------

function parseArgs(argv: string[]): SnippetMigrationOptions {
  const options: SnippetMigrationOptions = {};
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--apply") {
      options.mode = "apply";
    } else if (arg === "--dry-run") {
      options.mode = "dry-run";
    } else if (arg === "--workspace-bucket") {
      options.bucket = argv[++index];
    } else if (arg === "--tenant") {
      options.tenantSlug = argv[++index];
    } else if (arg === "--help" || arg === "-h") {
      console.log(`Legacy CONTEXT.md snippet migration (Composer plan U5, KTD-4).

Usage:
  pnpm exec tsx scripts/migrate-context-snippets.mts [--apply] [--workspace-bucket <bucket>] [--tenant <slug>]

Default mode is DRY-RUN: the full report is produced with zero writes.
Pass --apply to rewrite CONTEXT.md files. Run the dry-run first and
review editedSnippets / unmatchedOrphanLines before applying.`);
      process.exit(0);
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }
  return options;
}

export async function runContextSnippetMigrationCli(
  argv = process.argv.slice(2),
): Promise<void> {
  const result = await runContextSnippetMigration(parseArgs(argv));
  console.log(JSON.stringify(result, null, 2));
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  runContextSnippetMigrationCli().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
