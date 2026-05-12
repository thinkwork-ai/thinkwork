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

const UPGRADABLE_ARTIFACT_BUILDER_SHA256_BY_PATH = new Map<string, Set<string>>(
  [
    [
      ARTIFACT_BUILDER_SKILL_PATH,
      new Set([
        // PR #1072 default before the CRM dashboard recipe reference was added.
        "dafec59b0b2befe4ac6ff96899575e01c9c610a0a440b21722e9bb4a0b845584",
        // PR #1077 default with a relative CRM recipe path and weaker save guidance.
        "b01af0a1754d0b78a3a96b8627b4c871037f73cbd9a7c3bc4271a4b40a4e29ad",
        // PR #1124 default before Artifact Builder became a runbook compatibility shim.
        "d14a7c4af83f83026aa95bc0a6f85ee76e3f2614dd94568a61bfe5a355e3d96e",
        // PR #1166 default before dashboard visual quality and no-emoji icon rules.
        "a29ce8d2efb38b5e138022d541f0b9213703c3696b5941f8da047c750156ae1f",
      ]),
    ],
    [
      ARTIFACT_BUILDER_CRM_DASHBOARD_PATH,
      new Set([
        // PR #1124 CRM recipe before the CRM recipe moved into runbook phase guidance.
        "fb32d220a677004b11132e4ff17c1dae4ee129a96a51588532ce5746b0a9e362",
        // PR #1166 CRM recipe before dashboard visual quality and no-emoji icon rules.
        "d666dab7ae4e6420d07f3ad78b73eb7c0d4a140f87e414b7185d17f894b2655e",
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
