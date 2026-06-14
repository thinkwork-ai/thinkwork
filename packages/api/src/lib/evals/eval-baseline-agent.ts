/**
 * Eval-baseline agent provisioning (Skill Tests & Evals U3).
 *
 * A skill's eval cases must run in ISOLATION so a verdict is attributable
 * to the skill itself, not to the tenant's other installed skills or
 * workspace. We do that with a dedicated, reusable per-tenant "eval
 * baseline" agent whose workspace is re-materialized before each run to:
 *
 *   baseline template/defaults  +  EXACTLY the one skill under test
 *
 * Isolation is by MATERIALIZATION, not a DB toggle — the filesystem
 * (workspace `skills/<slug>/SKILL.md`) is the activation truth that
 * `resolveAgentRuntimeConfig` reads (`agent_skills` is derived). See
 * docs/solutions/architecture-patterns/workspace-skills-load-from-copied-agent-workspace-2026-04-28.md.
 *
 * Two load-bearing traps this guards against:
 *  - **bootstrap does NOT prune `skills/`.** `bootstrapAgentWorkspace(...,
 *    { mode: "overwrite" })` rewrites template/defaults source files only;
 *    it has no delete pass and never touches `skills/`. So a prior run's
 *    skill folder SURVIVES an overwrite — we must explicitly purge
 *    `skills/*` before installing the one target skill. The
 *    exactly-one-skill assertion is the loud backstop, not the cleaner.
 *  - **the eval-baseline agent must never be user-facing.** It is created
 *    `is_platform_default: false` (so `resolveTenantPlatformAgent` can
 *    never return it) and marked `source: "eval-baseline"` so tenant-wide
 *    agent listings exclude it (EVAL_BASELINE_AGENT_SOURCE). No new
 *    column — an existing agent-metadata flag suffices (U3 open question
 *    resolved: reuse `source`, no migration).
 *
 * Concurrency: the single reusable agent is a shared workspace prefix, so
 * per-tenant skill-eval runs SERIALIZE under a transaction advisory lock —
 * a batch install (a plugin bundling several skills) scores them in
 * sequence rather than racing the purge/materialize of one workspace.
 */

import {
  DeleteObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import {
  agents,
  and,
  db,
  eq,
  inArray,
  ne,
  sql,
  tenants,
} from "../../graphql/utils.js";
import { evalRuns } from "@thinkwork/database-pg/schema";
import { bootstrapAgentWorkspace } from "../workspace-bootstrap.js";
import { installCatalogSkill } from "../catalog-install.js";
import { regenerateManifest } from "../workspace-manifest.js";
import { resolveTenantPlatformAgent } from "../agents/tenant-platform-agent.js";
import { parseWiringMd } from "../wiring-md.js";

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

// Identity constants live in a leaf module so listing-exclusion call sites
// (tenantToolInventory) can import the `source` marker without dragging
// this module's S3/bootstrap/dataset-store chain. Imported for internal use
// AND re-exported for callers that already import from here.
import {
  EVAL_BASELINE_AGENT_SOURCE,
  EVAL_BASELINE_AGENT_NAME,
} from "./eval-baseline-constants.js";
export { EVAL_BASELINE_AGENT_SOURCE, EVAL_BASELINE_AGENT_NAME };

export class EvalBaselineMaterializationError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "EvalBaselineMaterializationError";
  }
}

/**
 * Raised when a second skill-eval run is launched for a tenant while one
 * is still in flight. The single reusable baseline workspace can't safely
 * back two concurrent runs (the async workers would read whichever skill
 * was materialized last), so runs serialize — the caller retries once the
 * in-flight run completes.
 */
export class EvalBaselineBusyError extends Error {
  constructor(public readonly tenantId: string) {
    super(
      `A skill evaluation is already running for this tenant; retry once it completes.`,
    );
    this.name = "EvalBaselineBusyError";
  }
}

export interface EvalBaselineAgent {
  id: string;
  slug: string;
}

export interface EvalBaselineMaterializeResult extends EvalBaselineAgent {
  skillSlug: string;
}

// ---------------------------------------------------------------------------
// Pure helpers (unit-testable without S3/DB)
// ---------------------------------------------------------------------------

/** Distinct skill slugs derived from `…/skills/<slug>/SKILL.md` keys. */
export function skillFoldersFromKeys(keys: string[]): string[] {
  const slugs = new Set<string>();
  for (const key of keys) {
    const match = key.match(/\/skills\/([^/]+)\/SKILL\.md$/);
    if (match) slugs.add(match[1]);
  }
  return [...slugs];
}

/**
 * The isolation backstop: the workspace must contain EXACTLY the one skill
 * under test (by `skills/<slug>/SKILL.md`). Zero (install failed) or two+
 * (purge missed a prior run's folder — the bootstrap-no-prune trap) aborts
 * the run loudly rather than scoring against the wrong skill set.
 */
export function assertExactlyOneSkillFolder(
  keys: string[],
  expectedSlug: string,
): void {
  const folders = skillFoldersFromKeys(keys);
  if (folders.length !== 1 || folders[0] !== expectedSlug) {
    throw new EvalBaselineMaterializationError(
      `Eval-baseline workspace must contain exactly the skill "${expectedSlug}", ` +
        `found [${folders.sort().join(", ")}] — aborting to avoid a wrong-skill verdict.`,
    );
  }
}

/** First wiring-choice id for a skill's WIRING.md (the eval install uses it). */
export function firstWiringChoiceId(wiringMd: string): string {
  const parsed = parseWiringMd(wiringMd);
  const first = parsed.suggestions[0];
  if (!first) {
    throw new EvalBaselineMaterializationError(
      "Skill WIRING.md has no wiring suggestions — cannot materialize for eval.",
    );
  }
  return first.id;
}

// ---------------------------------------------------------------------------
// Injectable workspace-mutation seam (faked in tests; S3-wired in prod)
// ---------------------------------------------------------------------------

export interface EvalBaselineWorkspaceOps {
  /** Reset baseline defaults/template files (overwrite mode). */
  bootstrap(agentId: string): Promise<void>;
  /** Delete every object under the workspace `skills/` prefix. */
  purgeSkills(): Promise<void>;
  /** Install exactly the one target skill into the workspace. */
  installSkill(skillSlug: string): Promise<void>;
  /** Regenerate the workspace manifest so the runtime re-syncs. */
  regenerateManifest(): Promise<void>;
  /** List every object key under the workspace `skills/` prefix (for the assert). */
  listSkillKeys(): Promise<string[]>;
}

/**
 * Re-materialize a baseline workspace to contain exactly one skill. Pure
 * orchestration over the ops seam: bootstrap → PURGE → install → manifest
 * → assert-exactly-one. Exported so the sequence (and the no-prune
 * regression guard) is unit-testable without S3/DB.
 */
export async function materializeWorkspaceForSkill(
  skillSlug: string,
  ops: EvalBaselineWorkspaceOps,
  agentId: string,
): Promise<void> {
  await ops.bootstrap(agentId); // resets defaults; does NOT touch skills/
  await ops.purgeSkills(); // the cleaner — overwrite alone leaves prior skills
  await ops.installSkill(skillSlug);
  await ops.regenerateManifest();
  assertExactlyOneSkillFolder(await ops.listSkillKeys(), skillSlug); // backstop
}

// ---------------------------------------------------------------------------
// Production wiring
// ---------------------------------------------------------------------------

function workspaceBucketOrThrow(): string {
  const bucket = getConfig("WORKSPACE_BUCKET");
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET environment variable is required");
  }
  return bucket;
}

function makeS3(): S3Client {
  return new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
}

async function resolveTenantSlug(tenantId: string): Promise<string> {
  const [tenant] = await db
    .select({ slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.id, tenantId));
  if (!tenant?.slug) {
    throw new EvalBaselineMaterializationError(
      `Tenant ${tenantId} has no slug — no workspace namespace for an eval-baseline agent.`,
    );
  }
  return tenant.slug;
}

/**
 * Ensure-or-create the hidden per-tenant eval-baseline agent. Idempotent
 * and race-safe: a unique-name conflict from a concurrent ensure re-selects
 * the row the other call created.
 */
export async function ensureEvalBaselineAgent(
  tenantId: string,
): Promise<EvalBaselineAgent> {
  const existing = await db
    .select({ id: agents.id, slug: agents.slug })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, tenantId),
        eq(agents.source, EVAL_BASELINE_AGENT_SOURCE),
      ),
    )
    .limit(1);
  if (existing[0]?.slug) {
    return { id: existing[0].id, slug: existing[0].slug };
  }

  // Best-effort model defaulting from the tenant's platform agent so the
  // baseline reflects the tenant's model environment. resolveAgentRuntimeConfig
  // re-resolves at run time; the run pins the effective model (U4).
  let model: string | null = null;
  try {
    model = (await resolveTenantPlatformAgent(tenantId)).model;
  } catch {
    model = null;
  }

  const existingFolders = await db
    .select({
      slug: agents.slug,
      workspaceFolderName: agents.workspace_folder_name,
    })
    .from(agents)
    .where(eq(agents.tenant_id, tenantId));

  const slug = generateSlug();
  try {
    const [inserted] = await db
      .insert(agents)
      .values({
        tenant_id: tenantId,
        name: EVAL_BASELINE_AGENT_NAME,
        slug,
        workspace_folder_name: workspaceFolderName(
          EVAL_BASELINE_AGENT_NAME,
          existingFolders.map((row) => row.workspaceFolderName ?? row.slug),
          "eval-baseline",
        ),
        source: EVAL_BASELINE_AGENT_SOURCE,
        runtime: "pi",
        status: "idle",
        system_prompt:
          "System eval-baseline agent for isolated skill evaluations. Not user-facing.",
        model,
        // Side-effect tools OFF on the baseline (the eval payload also strips
        // them, U4 — this is belt-and-suspenders so the baseline's "which
        // built-ins are on" set is reproducible and free of outbound actions).
        web_search: { enabled: false },
        web_extract: { enabled: false },
        send_email: { enabled: false },
        is_platform_default: false,
      })
      .returning({ id: agents.id, slug: agents.slug });
    return { id: inserted.id, slug: inserted.slug! };
  } catch (err) {
    // A concurrent ensure won the unique-name race — re-select its row.
    const retry = await db
      .select({ id: agents.id, slug: agents.slug })
      .from(agents)
      .where(
        and(
          eq(agents.tenant_id, tenantId),
          eq(agents.source, EVAL_BASELINE_AGENT_SOURCE),
        ),
      )
      .limit(1);
    if (retry[0]?.slug) return { id: retry[0].id, slug: retry[0].slug };
    throw err;
  }
}

/** Build the S3-backed workspace ops for a given baseline agent. */
function makeS3WorkspaceOps(
  s3: S3Client,
  bucket: string,
  tenantSlug: string,
  agentSlug: string,
): EvalBaselineWorkspaceOps {
  const targetPrefix = `tenants/${tenantSlug}/agents/${agentSlug}/`;
  const skillsPrefix = `${targetPrefix}skills/`;

  async function listKeys(prefix: string): Promise<string[]> {
    const keys: string[] = [];
    let token: string | undefined;
    do {
      const resp = await s3.send(
        new ListObjectsV2Command({
          Bucket: bucket,
          Prefix: prefix,
          ContinuationToken: token,
        }),
      );
      for (const obj of resp.Contents ?? []) {
        if (obj.Key) keys.push(obj.Key);
      }
      token = resp.IsTruncated ? resp.NextContinuationToken : undefined;
    } while (token);
    return keys;
  }

  return {
    async bootstrap(agentId) {
      await bootstrapAgentWorkspace(agentId, { mode: "overwrite" });
    },
    async purgeSkills() {
      for (const key of await listKeys(skillsPrefix)) {
        await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: key }));
      }
    },
    async installSkill(skillSlug) {
      const wiringMd = await readObject(
        s3,
        bucket,
        `tenants/${tenantSlug}/skill-catalog/${skillSlug}/WIRING.md`,
      );
      if (wiringMd == null) {
        throw new EvalBaselineMaterializationError(
          `Catalog skill "${skillSlug}" has no WIRING.md — cannot materialize for eval.`,
        );
      }
      await installCatalogSkill({
        s3,
        bucket,
        tenantSlug,
        targetPrefix,
        slug: skillSlug,
        wiringChoice: firstWiringChoiceId(wiringMd),
      });
    },
    async regenerateManifest() {
      await regenerateManifest(bucket, tenantSlug, agentSlug);
    },
    async listSkillKeys() {
      return listKeys(skillsPrefix);
    },
  };
}

async function readObject(
  s3: S3Client,
  bucket: string,
  key: string,
): Promise<string | null> {
  try {
    const resp = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return (await resp.Body?.transformToString("utf-8")) ?? null;
  } catch (e) {
    const name = (e as { name?: string }).name;
    const status = (e as { $metadata?: { httpStatusCode?: number } }).$metadata
      ?.httpStatusCode;
    if (name === "NoSuchKey" || name === "NotFound" || status === 404) {
      return null;
    }
    throw e;
  }
}

export interface SkillEvalEligibility {
  /** True when the catalog skill can be materialized for an isolated eval. */
  evaluable: boolean;
  /** Human reason it is NOT evaluable; null when evaluable. */
  reason: string | null;
}

/**
 * Whether a catalog skill can be RUN in an isolated eval (Skill Tests &
 * Evals — run eligibility). Mirrors the eval-baseline `installSkill`
 * materialization requirement EXACTLY — catalog `WIRING.md` present + a
 * usable wiring choice (the same requirement as a normal catalog install,
 * `catalog-install.ts`). The UI reads this to gate "Run evals now" so the
 * operator never picks a skill that can only fail with
 * EvalBaselineMaterializationError. A flagged case can still be SEEDED into
 * a not-yet-evaluable skill's dataset (forward-looking); only the run is
 * gated.
 */
export async function checkSkillEvalEligibility(
  tenantId: string,
  skillSlug: string,
): Promise<SkillEvalEligibility> {
  const tenantSlug = await resolveTenantSlug(tenantId);
  const bucket = workspaceBucketOrThrow();
  const s3 = makeS3();
  const wiringMd = await readObject(
    s3,
    bucket,
    `tenants/${tenantSlug}/skill-catalog/${skillSlug}/WIRING.md`,
  );
  if (wiringMd == null) {
    return {
      evaluable: false,
      reason:
        "This skill has no WIRING.md, so it can't be materialized for an isolated eval. Add a WIRING.md to the catalog skill to run evals.",
    };
  }
  try {
    firstWiringChoiceId(wiringMd);
  } catch {
    return {
      evaluable: false,
      reason:
        "This skill's WIRING.md has no wiring suggestions, so it can't be materialized for an isolated eval.",
    };
  }
  return { evaluable: true, reason: null };
}

const EVAL_BASELINE_LOCK_KEY = "eval-baseline-run";

/**
 * Production entry: ensure the eval-baseline agent exists, then (under a
 * per-tenant advisory lock so concurrent skill-eval runs serialize)
 * re-materialize its workspace to baseline + exactly the one target skill.
 * Returns the agent to invoke and the skill it now isolates.
 */
export async function materializeEvalBaselineWorkspace(
  tenantId: string,
  skillSlug: string,
): Promise<EvalBaselineMaterializeResult> {
  const tenantSlug = await resolveTenantSlug(tenantId);
  const bucket = workspaceBucketOrThrow();
  const s3 = makeS3();

  return db.transaction(async (tx) => {
    // Serialize per-tenant: the single baseline agent is a shared workspace
    // prefix, so two concurrent runs would race the purge/materialize.
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${tenantId}), hashtext(${EVAL_BASELINE_LOCK_KEY}))`,
    );
    const agent = await ensureEvalBaselineAgent(tenantId);
    const ops = makeS3WorkspaceOps(s3, bucket, tenantSlug, agent.slug);
    await materializeWorkspaceForSkill(skillSlug, ops, agent.id);
    return { id: agent.id, slug: agent.slug, skillSlug };
  });
}

/**
 * Claim the eval-baseline agent for a specific run: under the per-tenant
 * advisory lock, refuse if another run already holds the baseline (in
 * flight), re-materialize the workspace for this run's skill, and assign
 * the baseline agent to the run — all atomically so a concurrent launch
 * blocks on the lock, then sees this run's claim and backs off
 * (EvalBaselineBusyError). The runner/worker then invoke `run.agent_id`
 * unchanged.
 */
export async function claimEvalBaselineForRun(args: {
  tenantId: string;
  skillSlug: string;
  runId: string;
}): Promise<EvalBaselineMaterializeResult> {
  const tenantSlug = await resolveTenantSlug(args.tenantId);
  const bucket = workspaceBucketOrThrow();
  const s3 = makeS3();

  return db.transaction(async (tx) => {
    await tx.execute(
      sql`SELECT pg_advisory_xact_lock(hashtext(${args.tenantId}), hashtext(${EVAL_BASELINE_LOCK_KEY}))`,
    );
    const agent = await ensureEvalBaselineAgent(args.tenantId);

    // In-flight gate: another run already claimed the baseline (agent_id set,
    // still pending/running)? Refuse — runs serialize so the async workers
    // never read a workspace re-materialized out from under them.
    const inFlight = await tx
      .select({ id: evalRuns.id })
      .from(evalRuns)
      .where(
        and(
          eq(evalRuns.tenant_id, args.tenantId),
          eq(evalRuns.agent_id, agent.id),
          inArray(evalRuns.status, ["pending", "running"]),
          ne(evalRuns.id, args.runId),
        ),
      )
      .limit(1);
    if (inFlight.length > 0) throw new EvalBaselineBusyError(args.tenantId);

    const ops = makeS3WorkspaceOps(s3, bucket, tenantSlug, agent.slug);
    await materializeWorkspaceForSkill(args.skillSlug, ops, agent.id);

    // Claim inside the lock so a blocked concurrent launch sees it.
    await tx
      .update(evalRuns)
      .set({ agent_id: agent.id })
      .where(eq(evalRuns.id, args.runId));

    return { id: agent.id, slug: agent.slug, skillSlug: args.skillSlug };
  });
}
