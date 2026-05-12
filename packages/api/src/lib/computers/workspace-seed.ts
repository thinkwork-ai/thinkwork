import {
  CopyObjectCommand,
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import {
  agents,
  agentTemplates,
  computers,
  tenants,
} from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";
import { isBuiltinToolWorkspacePath } from "../builtin-tool-slugs.js";
import { enqueueComputerTask } from "./tasks.js";

const db = getDb();
const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const MAX_SEED_FILE_BYTES = 256 * 1024;
const CATALOG_SKILL_PREFIX = "skills/catalog";

export const PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG =
  "thinkwork-computer-default";

export const DEFAULT_COMPUTER_RUNBOOK_SKILL_SLUGS = [
  "crm-dashboard",
  "research-dashboard",
  "map-artifact",
] as const;

type ComputerSeedRow = {
  id: string;
  tenant_id: string;
  migrated_from_agent_id: string | null;
  migration_metadata: unknown;
};

type SourceWorkspaceFile = {
  path: string;
  key: string;
  etag: string | null;
  size: number;
};

type DefaultRunbookSkillRow = {
  id: string;
  tenant_id: string;
  tenant_slug: string | null;
  template_tenant_id: string | null;
  template_slug: string | null;
  template_source: string | null;
  template_kind: string | null;
};

export async function ensureMigratedComputerWorkspaceSeeded(input: {
  tenantId: string;
  computerId: string;
}) {
  const computer = await loadComputer(input.tenantId, input.computerId);
  if (!computer?.migrated_from_agent_id) {
    return { seeded: false, reason: "no_source_agent" };
  }

  const existingSeed = migrationMetadata(computer).efsWorkspaceSeed;
  if (
    existingSeed &&
    typeof existingSeed === "object" &&
    (existingSeed as Record<string, unknown>).sourceAgentId ===
      computer.migrated_from_agent_id
  ) {
    return { seeded: false, reason: "already_seeded" };
  }

  const source = await loadSourceAgentWorkspace({
    tenantId: input.tenantId,
    agentId: computer.migrated_from_agent_id,
  });
  if (!source) return { seeded: false, reason: "source_agent_missing" };

  const files = await listWorkspaceFiles(source.prefix);
  let enqueued = 0;
  let skipped = 0;

  for (const file of files) {
    if (file.size === 0 || file.size > MAX_SEED_FILE_BYTES) {
      skipped++;
      continue;
    }
    const content = await readWorkspaceFile(file.key);
    if (!content.trim()) {
      skipped++;
      continue;
    }
    await enqueueComputerTask({
      tenantId: input.tenantId,
      computerId: input.computerId,
      taskType: "workspace_file_write",
      taskInput: { path: file.path, content },
      idempotencyKey: [
        "computer_workspace_seed",
        input.computerId,
        computer.migrated_from_agent_id,
        file.path,
        file.etag ?? "no-etag",
      ].join(":"),
    });
    enqueued++;
  }

  await markSeeded(computer, {
    sourceAgentId: computer.migrated_from_agent_id,
    sourceAgentSlug: source.agentSlug,
    enqueued,
    skipped,
    seededAt: new Date().toISOString(),
  });

  return { seeded: true, enqueued, skipped };
}

export async function ensureDefaultComputerRunbookSkillsMaterialized(input: {
  tenantId: string;
  computerId: string;
}) {
  const target = await loadDefaultRunbookSkillTarget(
    input.tenantId,
    input.computerId,
  );
  if (!target) return { seeded: false, reason: "computer_missing" };
  if (
    target.template_slug !== PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG ||
    target.template_tenant_id !== null ||
    target.template_source !== "system" ||
    target.template_kind !== "computer" ||
    !target.tenant_slug
  ) {
    return { seeded: false, reason: "non_default_template" };
  }

  let copied = 0;
  let enqueued = 0;
  let skipped = 0;

  for (const skillSlug of DEFAULT_COMPUTER_RUNBOOK_SKILL_SLUGS) {
    const sourcePrefix = `${CATALOG_SKILL_PREFIX}/${skillSlug}/`;
    const templatePrefix = `tenants/${target.tenant_slug}/agents/_catalog/${PLATFORM_DEFAULT_COMPUTER_TEMPLATE_SLUG}/workspace/skills/${skillSlug}/`;
    const files = await listWorkspaceFiles(sourcePrefix);

    for (const file of files) {
      if (file.size === 0 || file.size > MAX_SEED_FILE_BYTES) {
        skipped++;
        continue;
      }
      const content = await readWorkspaceFile(file.key);
      if (!content.trim()) {
        skipped++;
        continue;
      }

      const destinationKey = `${templatePrefix}${file.path}`;
      await copyWorkspaceFile(file.key, destinationKey);
      copied++;

      await enqueueComputerTask({
        tenantId: input.tenantId,
        computerId: input.computerId,
        taskType: "workspace_file_write",
        taskInput: {
          path: `skills/${skillSlug}/${file.path}`,
          content,
        },
        idempotencyKey: [
          "computer_default_runbook_skill",
          input.computerId,
          skillSlug,
          file.path,
          file.etag ?? "no-etag",
        ].join(":"),
      });
      enqueued++;
    }
  }

  return { seeded: true, copied, enqueued, skipped };
}

async function loadComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
      migration_metadata: computers.migration_metadata,
    })
    .from(computers)
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  return computer;
}

async function loadSourceAgentWorkspace(input: {
  tenantId: string;
  agentId: string;
}) {
  const [row] = await db
    .select({
      agent_slug: agents.slug,
      tenant_slug: tenants.slug,
    })
    .from(agents)
    .leftJoin(tenants, eq(tenants.id, agents.tenant_id))
    .where(
      and(eq(agents.tenant_id, input.tenantId), eq(agents.id, input.agentId)),
    )
    .limit(1);

  if (!row?.agent_slug || !row.tenant_slug) return null;
  return {
    agentSlug: row.agent_slug,
    prefix: `tenants/${row.tenant_slug}/agents/${row.agent_slug}/workspace/`,
  };
}

async function loadDefaultRunbookSkillTarget(
  tenantId: string,
  computerId: string,
): Promise<DefaultRunbookSkillRow | undefined> {
  const [row] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      tenant_slug: tenants.slug,
      template_tenant_id: agentTemplates.tenant_id,
      template_slug: agentTemplates.slug,
      template_source: agentTemplates.source,
      template_kind: agentTemplates.template_kind,
    })
    .from(computers)
    .leftJoin(tenants, eq(tenants.id, computers.tenant_id))
    .leftJoin(agentTemplates, eq(agentTemplates.id, computers.template_id))
    .where(and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)))
    .limit(1);
  return row;
}

async function listWorkspaceFiles(
  prefix: string,
): Promise<SourceWorkspaceFile[]> {
  const bucket = workspaceBucket();
  const files: SourceWorkspaceFile[] = [];
  let continuationToken: string | undefined;

  do {
    const response = await s3.send(
      new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (!object.Key) continue;
      const path = object.Key.slice(prefix.length);
      if (
        !path ||
        path === "manifest.json" ||
        path === "_defaults_version" ||
        isBuiltinToolWorkspacePath(path)
      ) {
        continue;
      }
      files.push({
        path,
        key: object.Key,
        etag: object.ETag?.replace(/^"|"$/g, "") ?? null,
        size: object.Size ?? 0,
      });
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);

  return files;
}

async function readWorkspaceFile(key: string) {
  const response = await s3.send(
    new GetObjectCommand({ Bucket: workspaceBucket(), Key: key }),
  );
  return (await response.Body?.transformToString("utf-8")) ?? "";
}

async function copyWorkspaceFile(sourceKey: string, destinationKey: string) {
  const bucket = workspaceBucket();
  await s3.send(
    new CopyObjectCommand({
      Bucket: bucket,
      CopySource: `${bucket}/${sourceKey}`,
      Key: destinationKey,
    }),
  );
}

async function markSeeded(
  computer: ComputerSeedRow,
  seed: Record<string, unknown>,
) {
  await db
    .update(computers)
    .set({
      migration_metadata: {
        ...migrationMetadata(computer),
        efsWorkspaceSeed: seed,
      },
      updated_at: new Date(),
    })
    .where(
      and(
        eq(computers.tenant_id, computer.tenant_id),
        eq(computers.id, computer.id),
      ),
    );
}

function migrationMetadata(computer: ComputerSeedRow): Record<string, unknown> {
  return computer.migration_metadata &&
    typeof computer.migration_metadata === "object" &&
    !Array.isArray(computer.migration_metadata)
    ? (computer.migration_metadata as Record<string, unknown>)
    : {};
}

function workspaceBucket() {
  const bucket = process.env.WORKSPACE_BUCKET || process.env.BUCKET_NAME || "";
  if (!bucket) {
    throw new Error("WORKSPACE_BUCKET is required to seed Computer workspace");
  }
  return bucket;
}
