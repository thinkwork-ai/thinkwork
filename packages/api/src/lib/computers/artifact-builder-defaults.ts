import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { loadDefaults } from "@thinkwork/workspace-defaults";
import { agents, computers, tenants } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

const db = getDb();
const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const ARTIFACT_BUILDER_PATHS = [
  "skills/artifact-builder/SKILL.md",
  "skills/artifact-builder/references/crm-dashboard.md",
] as const;
const ARTIFACT_BUILDER_SKILL_PATH = "skills/artifact-builder/SKILL.md";
const ARTIFACT_BUILDER_CRM_DASHBOARD_PATH =
  "skills/artifact-builder/references/crm-dashboard.md";

const WORKSPACE_DEFAULTS_SKILL_SOURCE =
  "packages/workspace-defaults/files/skills/artifact-builder/SKILL.md";
const WORKSPACE_DEFAULTS_CRM_SOURCE =
  "packages/workspace-defaults/files/skills/artifact-builder/references/crm-dashboard.md";

export type ArtifactBuilderManagedPath =
  | typeof WORKSPACE_DEFAULTS_SKILL_SOURCE
  | typeof WORKSPACE_DEFAULTS_CRM_SOURCE;

// The upgradable set is the **complete** content history of each managed file on
// `main` (every historical SHA, excluding the current HEAD SHA which is what
// `loadDefaults()` already writes). When `ensureArtifactBuilderDefaults` finds an
// agent's workspace file matching any of these SHAs, it overwrites with the
// current default — any other content is treated as user customization and left
// alone. The parity test `artifact-builder-defaults.history.test.ts` walks
// `git log` for each managed path and asserts every historical SHA is present
// here, so drift fails CI rather than silently stranding agents on old defaults
// (as happened with the orphan `4281155...` SHA from commit 6b31f0f4 before this
// backfill landed).
const UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH = new Map<string, Set<string>>(
  [
    [
      ARTIFACT_BUILDER_SKILL_PATH,
      new Set([
        // bd16d23a feat(computer): make artifact builder skill driven (PR #1072)
        "dafec59b0b2befe4ac6ff96899575e01c9c610a0a440b21722e9bb4a0b845584",
        // 16332758 feat(computer): add Artifact Builder CRM recipe (#1077)
        "b01af0a1754d0b78a3a96b8627b4c871037f73cbd9a7c3bc4271a4b40a4e29ad",
        // 6b31f0f4 fix(computer): keep artifact builder save in parent turn
        "4281155ec9c4b488d45d494d959765be3c2ac503f04a069334b09b711c4d988e",
        // 9fc2bb17 feat(computer): mount generated applets inline in thread message bubbles (#1086)
        "c80d584130c9ce1bd281e9a52d944822647f281c382234a0cca2144bccb6d04b",
        // 188acc6 feat(computer): adopt AI Elements for Computer threads (#1101)
        "cc4b9d4b246cd02f218ab9e4f154883ad390c1a4bdefdf004f09daf3b044493b",
        // 5dfbd4e6 docs(computer): update generated app authoring guidance (PR #1124)
        "d14a7c4af83f83026aa95bc0a6f85ee76e3f2614dd94568a61bfe5a355e3d96e",
        // f6832e4f feat(runbooks): bridge artifact builder recipes (PR #1166)
        "a29ce8d2efb38b5e138022d541f0b9213703c3696b5941f8da047c750156ae1f",
        // 32ecce5d fix: raise crm dashboard artifact quality bar (#1168)
        "016e873f6f5f33b1d3aded464597dc9dfa618193d249e88b0366e09080c66622",
        // 602d8e41 fix(computer): stabilize follow-up streaming (#1181)
        "78a41afa11db6c8c4f2df7dca3f87f6c3b49148c63675d2978715a63988e6005",
        // fee977e7 feat: wire shadcn registry guidance
        "03fdd405ada34eec21e5bef31be4b50ce489b65eb8973fef5fca3d3d319ae067",
        // ab61e600 fix(computer): streamline CRM artifact runbooks
        "5fc55f4b3967dff02ec0b8579bfa0ca9fe43ee7660bb516698af57a819903b07",
        // fce54566 feat: add artifact app style tokens
        "c13c60b12c52acc80626ec3978d7062ecb1f556b6b1c52c08b73139b1c37054c",
        // dd570705 feat: improve applet detail and host app styles
        "4d194d06d2452d369a1ed93dde88ed43741cece5fff44dd4f06c61a2124b021e",
        // 01895080 fix: enforce CRM dashboard artifact layout (#1222)
        "b9a534d403d84e62617388f7bf3f76d6d218eb824da898f4412264faf523077c",
      ]),
    ],
    [
      ARTIFACT_BUILDER_CRM_DASHBOARD_PATH,
      new Set([
        // 16332758 feat(computer): add Artifact Builder CRM recipe (#1077)
        "c12f45cb48d1252fb7c1a5cb9a303ca33e60040dca0d8730db27a15a5ed7733c",
        // 16c6afc8 fix(computer): tolerate generated applet prop aliases (#1092)
        "4c6dd24729d72ba64b66374fc510697346633dd60bb0fd707b5eed934d20782c",
        // b0086738 fix(computer): move artifact refresh into actions menu
        "22884ad13c00afa18a5b9ab174a7662909b99d5aac066cbb0b6d7b987b973ab6",
        // 188acc6 feat(computer): adopt AI Elements for Computer threads (#1101)
        "8d56abfa1aac5fee309cf8565fd6528c5b9397913a2e861438f69613fd1f0f29",
        // 5dfbd4e6 docs(computer): update generated app authoring guidance (PR #1124)
        "fb32d220a677004b11132e4ff17c1dae4ee129a96a51588532ce5746b0a9e362",
        // f6832e4f feat(runbooks): bridge artifact builder recipes (PR #1166)
        "d666dab7ae4e6420d07f3ad78b73eb7c0d4a140f87e414b7185d17f894b2655e",
        // 32ecce5d fix: raise crm dashboard artifact quality bar (#1168)
        "f6b5d0a8cfdf173bf3db6b745d87534d8c2a8e70997e028e1a82ebf16ffdd38c",
        // 602d8e41 fix(computer): stabilize follow-up streaming (#1181)
        "7ef426ec3c1ff98df9fbafc7b4e562fad7da2cfe6bc13f742444afaf7e9569d9",
        // ab61e600 fix(computer): streamline CRM artifact runbooks
        "450c976ffc2596896f57d8771eed975bab274f021d2d606222bb709a25963917",
        // fce54566 feat: add artifact app style tokens
        "7324b0abf57daa0d16631265491a89a6906345d0e2337059339e03fb65b06fbd",
        // dd570705 feat: improve applet detail and host app styles
        "e7ddfbe953ea15a9bc3f57dada4e9e0684a3fae37a9c83dc963b0515288e1905",
      ]),
    ],
  ],
);

export type ArtifactBuilderDefaultsResult =
  | {
      ensured: true;
      written: string[];
      updated: string[];
      skipped: string[];
      agentSlug: string;
    }
  | {
      ensured: false;
      reason:
        | "computer_missing"
        | "missing_backing_agent"
        | "backing_agent_missing"
        | "tenant_slug_missing";
    };

export async function ensureArtifactBuilderDefaults(input: {
  tenantId: string;
  computerId: string;
}): Promise<ArtifactBuilderDefaultsResult> {
  const target = await loadBackingAgentWorkspace(input);
  if (!target.ok) return { ensured: false, reason: target.reason };

  const defaults = loadDefaults();
  const written: string[] = [];
  const updated: string[] = [];
  const skipped: string[] = [];

  for (const path of ARTIFACT_BUILDER_PATHS) {
    const key = `${target.prefix}${path}`;
    const existing = await readObjectIfExists(key);
    if (existing === null) {
      await putDefaultFile(key, defaults[path]);
      written.push(path);
      continue;
    }
    if (isUpgradableArtifactBuilderDefault(path, existing)) {
      await putDefaultFile(key, defaults[path]);
      updated.push(path);
      continue;
    }
    skipped.push(path);
  }

  return {
    ensured: true,
    written,
    updated,
    skipped,
    agentSlug: target.agentSlug,
  };
}

async function putDefaultFile(key: string, content: string) {
  await s3.send(
    new PutObjectCommand({
      Bucket: workspaceBucket(),
      Key: key,
      Body: content,
      ContentType: "text/markdown",
    }),
  );
}

async function readObjectIfExists(key: string): Promise<string | null> {
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
    );
    return (await response.Body?.transformToString("utf-8")) ?? "";
  } catch (err) {
    if (isMissingObjectError(err)) return null;
    throw err;
  }
}

function lookupHistorical(s3Path: string): ReadonlySet<string> {
  const set = UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH.get(s3Path);
  if (!set) {
    // Surfaces a missing-key bug at module load (during test import) rather
    // than handing the parity test an empty Set that silently loops zero times.
    throw new Error(
      `UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH is missing an entry for ${s3Path}`,
    );
  }
  return set;
}

/**
 * Source-of-truth view of the upgradable-SHA history keyed by the `packages/...`
 * repo-relative source path (not the S3 workspace path). Exported only for the
 * history parity test in `artifact-builder-defaults.history.test.ts`, which
 * walks `git log` for each managed file and asserts every prior-version SHA is
 * registered here. Do not import this anywhere outside that test; production
 * code reads `UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH` directly.
 *
 * @internal
 */
export const ARTIFACT_BUILDER_HISTORY_FOR_TESTING: Readonly<
  Record<ArtifactBuilderManagedPath, ReadonlySet<string>>
> = {
  [WORKSPACE_DEFAULTS_SKILL_SOURCE]: lookupHistorical(
    ARTIFACT_BUILDER_SKILL_PATH,
  ),
  [WORKSPACE_DEFAULTS_CRM_SOURCE]: lookupHistorical(
    ARTIFACT_BUILDER_CRM_DASHBOARD_PATH,
  ),
};

function isUpgradableArtifactBuilderDefault(path: string, content: string) {
  return (
    UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH.get(path)?.has(
      createHash("sha256").update(content).digest("hex"),
    ) === true
  );
}

async function loadBackingAgentWorkspace(input: {
  tenantId: string;
  computerId: string;
}): Promise<
  | { ok: true; agentSlug: string; prefix: string }
  | {
      ok: false;
      reason:
        | "computer_missing"
        | "missing_backing_agent"
        | "backing_agent_missing"
        | "tenant_slug_missing";
    }
> {
  const [row] = await db
    .select({
      migrated_from_agent_id: computers.migrated_from_agent_id,
      agent_slug: agents.slug,
      tenant_slug: tenants.slug,
    })
    .from(computers)
    .leftJoin(agents, eq(agents.id, computers.migrated_from_agent_id))
    .leftJoin(tenants, eq(tenants.id, computers.tenant_id))
    .where(
      and(
        eq(computers.tenant_id, input.tenantId),
        eq(computers.id, input.computerId),
      ),
    )
    .limit(1);

  if (!row) return { ok: false, reason: "computer_missing" };
  if (!row.migrated_from_agent_id) {
    return { ok: false, reason: "missing_backing_agent" };
  }
  if (!row.agent_slug) return { ok: false, reason: "backing_agent_missing" };
  if (!row.tenant_slug) return { ok: false, reason: "tenant_slug_missing" };

  return {
    ok: true,
    agentSlug: row.agent_slug,
    prefix: `tenants/${row.tenant_slug}/agents/${row.agent_slug}/workspace/`,
  };
}

function isMissingObjectError(err: unknown) {
  if (!err || typeof err !== "object") return false;
  const maybeError = err as {
    name?: string;
    $metadata?: { httpStatusCode?: number };
  };
  return (
    maybeError.name === "NotFound" ||
    maybeError.name === "NoSuchKey" ||
    maybeError.$metadata?.httpStatusCode === 404
  );
}

function workspaceBucket() {
  const bucket = process.env.WORKSPACE_BUCKET || process.env.BUCKET_NAME || "";
  if (!bucket) {
    throw new Error(
      "WORKSPACE_BUCKET is required to seed Artifact Builder defaults",
    );
  }
  return bucket;
}
