import {
  GetObjectCommand,
  HeadObjectCommand,
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

const UPGRADABLE_ARTIFACT_BUILDER_SKILL_SHA256 = new Set([
  // PR #1072 default before the CRM dashboard recipe reference was added.
  "dafec59b0b2befe4ac6ff96899575e01c9c610a0a440b21722e9bb4a0b845584",
]);

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
    if (path === ARTIFACT_BUILDER_SKILL_PATH) {
      const existingSkill = await readObjectIfExists(key);
      if (existingSkill === null) {
        await putDefaultFile(key, defaults[path]);
        written.push(path);
        continue;
      }
      if (isUpgradableArtifactBuilderSkill(existingSkill)) {
        await putDefaultFile(key, defaults[path]);
        updated.push(path);
        continue;
      }
      skipped.push(path);
      continue;
    }

    if (await objectExists(key)) {
      skipped.push(path);
      continue;
    }
    await putDefaultFile(key, defaults[path]);
    written.push(path);
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

function isUpgradableArtifactBuilderSkill(content: string) {
  return UPGRADABLE_ARTIFACT_BUILDER_SKILL_SHA256.has(
    createHash("sha256").update(content).digest("hex"),
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

async function objectExists(key: string) {
  try {
    await s3.send(
      new HeadObjectCommand({ Bucket: workspaceBucket(), Key: key }),
    );
    return true;
  } catch (err) {
    if (isMissingObjectError(err)) return false;
    throw err;
  }
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
