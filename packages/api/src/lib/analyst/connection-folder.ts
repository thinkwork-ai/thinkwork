/**
 * Analyst workspace connection folder (THINK-228 U5, KTD5).
 *
 * Materializes `connections/postgres-dev/` into every tenant agent's
 * workspace SOURCE prefix: the signed CONNECTION.md definition (via the
 * standard capability folder write path) plus the generated semantic
 * model as a sibling `SCHEMA.md`. Files under `connections/<slug>/**`
 * already materialize into the rendered agent workspace and feed the
 * capability input signature — no renderer changes. No CONTEXT.md slot is
 * connection-aware today, so CONNECTION.md's prose points the analyst at
 * SCHEMA.md by relative path.
 *
 * Called from scripts/provision-analyst-connector.mts after the registry
 * row seed (U4); re-running after a schema regeneration refreshes the
 * workspace copy and (because the sidecar signs the definition bytes)
 * re-signs the folder.
 */

import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { getConfig } from "@thinkwork/runtime-config";
import { and, eq, sql } from "drizzle-orm";
import { agents, tenantMcpServers } from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../../graphql/utils.js";
import {
  connectionDefinitionFromRegistryRow,
  putCapabilityFolder,
  type CapabilityFolderWriteDeps,
} from "../capabilities/folder-write.js";
import type { CapabilitySignedBy } from "../capabilities/sidecar-signing.js";
import { resolveAgentWorkspacePrefix } from "../skills/assignment-state.js";

type DbLike = typeof defaultDb;

export const ANALYST_SCHEMA_FILE = "SCHEMA.md";

/** The analyst-specific prose appended to the generated CONNECTION.md. */
export const ANALYST_CONNECTION_GUIDANCE = `
## Writing SQL for run_query

Read [SCHEMA.md](./SCHEMA.md) in this folder BEFORE writing any SQL — it is
the generated semantic model for this data source: every granted table with
column types, foreign-key join hints, and enum value legends. Tables or
columns not listed there are not granted to your database role. Name columns
explicitly (avoid \`SELECT *\`), prefer aggregated queries (GROUP BY) sized to
fit charts and tables, and scope by \`tenant_id\` unless the question is
explicitly cross-tenant.
`;

export function analystConnectionDefinition(row: {
  slug: string | null;
  name: string;
  url: string;
  transport?: string | null;
  tools?: unknown;
}): { slug: string; definition: string } {
  const generated = connectionDefinitionFromRegistryRow(row);
  return {
    slug: generated.slug,
    definition: `${generated.definition}${ANALYST_CONNECTION_GUIDANCE}`,
  };
}

function workspaceBucket(): string | null {
  try {
    return getConfig("WORKSPACE_BUCKET") || null;
  } catch {
    return null;
  }
}

let sharedClient: S3Client | null = null;
function s3Client(): Pick<S3Client, "send"> {
  sharedClient ??= new S3Client({
    region:
      process.env.AWS_REGION || process.env.AWS_DEFAULT_REGION || "us-east-1",
  });
  return sharedClient;
}

export interface MaterializeResult {
  /** Workspace-relative files written per agent, e.g. connections/postgres-dev/CONNECTION.md */
  files: string[];
  agents: number;
  skipped: Array<{ agentId: string; reason: string }>;
}

export async function materializeAnalystConnectionFolder(input: {
  tenantId: string;
  tenantMcpServerId: string;
  /** The generated semantic model markdown (packages/database-pg/generated/analyst/SCHEMA.md). */
  schemaMarkdown: string;
  signedBy?: CapabilitySignedBy;
  db?: DbLike;
  deps?: CapabilityFolderWriteDeps;
}): Promise<MaterializeResult> {
  const db = input.db ?? defaultDb;
  const signedBy: CapabilitySignedBy =
    input.signedBy ?? "operator:provision-analyst-connector";

  const [row] = await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      name: tenantMcpServers.name,
      url: tenantMcpServers.url,
      transport: tenantMcpServers.transport,
      tools: tenantMcpServers.tools,
      status: tenantMcpServers.status,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, input.tenantMcpServerId),
        eq(tenantMcpServers.tenant_id, input.tenantId),
      ),
    )
    .limit(1);
  if (!row) {
    throw new Error(
      `analyst connection folder: registry row ${input.tenantMcpServerId} not found for tenant ${input.tenantId}`,
    );
  }
  if (row.status !== "approved") {
    throw new Error(
      `analyst connection folder: registry row is ${row.status}, not approved — run the seed/--re-approve first`,
    );
  }

  const { slug, definition } = analystConnectionDefinition(row);

  const agentRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, input.tenantId),
        sql`${agents.status} <> 'archived'`,
      ),
    );
  if (agentRows.length === 0) {
    throw new Error(
      `analyst connection folder: tenant ${input.tenantId} has no agents to materialize into`,
    );
  }

  const bucket = input.deps?.bucket ?? workspaceBucket();
  if (!bucket) {
    throw new Error(
      "analyst connection folder: WORKSPACE_BUCKET is not configured",
    );
  }
  const s3 = input.deps?.s3 ?? s3Client();

  const skipped: MaterializeResult["skipped"] = [];
  let written = 0;
  for (const agent of agentRows) {
    const targetPrefix = await resolveAgentWorkspacePrefix(agent.id);
    if (!targetPrefix) {
      skipped.push({ agentId: agent.id, reason: "no_workspace_prefix" });
      continue;
    }
    const result = await putCapabilityFolder({
      targetPrefix,
      klass: "connection",
      slug,
      definition,
      sidecar: {
        enabled: true,
        permissions: { operations: ["run_query"] },
        config: { registryServerId: row.id },
      },
      signedBy,
      deps: { ...input.deps, bucket, s3 },
    });
    if (!result.ok) {
      skipped.push({ agentId: agent.id, reason: result.reason });
      continue;
    }
    await s3.send(
      new PutObjectCommand({
        Bucket: bucket,
        Key: `${targetPrefix}connections/${slug}/${ANALYST_SCHEMA_FILE}`,
        Body: input.schemaMarkdown,
        ContentType: "text/markdown; charset=utf-8",
      }),
    );
    written += 1;
  }

  if (written === 0) {
    throw new Error(
      `analyst connection folder: no agent workspace was written (${JSON.stringify(skipped)})`,
    );
  }

  return {
    files: [
      `connections/${slug}/CONNECTION.md`,
      `connections/${slug}/.assignment.json`,
      `connections/${slug}/${ANALYST_SCHEMA_FILE}`,
    ],
    agents: written,
    skipped,
  };
}
