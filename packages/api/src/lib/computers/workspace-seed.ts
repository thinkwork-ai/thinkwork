import {
  GetObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";
import { and, eq } from "drizzle-orm";
import { agents, computers, tenants } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";
import { isBuiltinToolWorkspacePath } from "../builtin-tool-slugs.js";
import { enqueueComputerTask } from "./tasks.js";

const db = getDb();
const s3 = new S3Client({
  region:
    process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
});

const MAX_SEED_FILE_BYTES = 256 * 1024;

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

async function loadComputer(tenantId: string, computerId: string) {
  const [computer] = await db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
      migration_metadata: computers.migration_metadata,
    })
    .from(computers)
    .where(
      and(eq(computers.tenant_id, tenantId), eq(computers.id, computerId)),
    )
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
