import {
  DeleteSecretCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import {
  agentMcpServers,
  agents,
  agentTemplateMcpServers,
  spaceMcpServers,
  tenantMcpContextTools,
  tenantMcpServers,
  userMcpTokens,
} from "@thinkwork/database-pg/schema";
import type { ManagedApplicationStatus } from "../graphql/resolvers/core/managedApplications.js";
import { db as defaultDb } from "../graphql/utils.js";
import { computeMcpUrlHash } from "./mcp-server-hash.js";

export const TWENTY_MANAGED_MCP_KEY = "twenty-crm";
export const TWENTY_MANAGED_MCP_SLUG = "twenty-crm";
export const TWENTY_MANAGED_MCP_NAME = "Twenty CRM";

type DbLike = typeof defaultDb;

export type ManagedMcpDeploymentState = {
  serverId: string | null;
  installed: boolean;
  installAvailable: boolean;
  status: string;
  message: string | null;
};

export type ManagedMcpRow = {
  id: string;
  slug: string;
  url: string;
  enabled: boolean;
  status: string;
  url_hash: string | null;
  auth_config: unknown;
  management_source: string;
  managed_application_key: string | null;
};

export function twentyMcpUrlFromApplicationUrl(applicationUrl: string): string {
  const url = new URL(applicationUrl);
  url.pathname = "/mcp";
  url.search = "";
  url.hash = "";
  return url.toString().replace(/\/$/, "");
}

export async function enrichManagedApplicationsWithMcpState(
  tenantId: string | null,
  applications: ManagedApplicationStatus[],
  db: DbLike = defaultDb,
): Promise<ManagedApplicationStatus[]> {
  if (!tenantId) return applications;

  return Promise.all(
    applications.map(async (application) => {
      if (application.key !== "twenty") return application;
      const state = await readTwentyManagedMcpState(tenantId, application, db);
      return applyManagedMcpState(application, state);
    }),
  );
}

export async function readTwentyManagedMcpState(
  tenantId: string,
  application: ManagedApplicationStatus,
  db: DbLike = defaultDb,
): Promise<ManagedMcpDeploymentState> {
  const [row] = (await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      enabled: tenantMcpServers.enabled,
      status: tenantMcpServers.status,
      url_hash: tenantMcpServers.url_hash,
      auth_config: tenantMcpServers.auth_config,
      management_source: tenantMcpServers.management_source,
      managed_application_key: tenantMcpServers.managed_application_key,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        eq(tenantMcpServers.managed_application_key, TWENTY_MANAGED_MCP_KEY),
      ),
    )
    .limit(1)) as ManagedMcpRow[];

  return summarizeTwentyManagedMcpState(application, row ?? null);
}

export function summarizeTwentyManagedMcpState(
  application: ManagedApplicationStatus,
  row: ManagedMcpRow | null,
): ManagedMcpDeploymentState {
  const canInstall =
    application.key === "twenty" &&
    application.status === "running" &&
    application.runtimeEnabled &&
    Boolean(application.url);

  if (!row) {
    return {
      serverId: null,
      installed: false,
      installAvailable: canInstall,
      status: canInstall ? "missing" : "not_ready",
      message: canInstall
        ? "Twenty CRM MCP server has not been registered yet."
        : null,
    };
  }

  const expectedUrl = application.url
    ? twentyMcpUrlFromApplicationUrl(application.url)
    : null;
  const urlMatches = expectedUrl === null || row.url === expectedUrl;
  const approvedHashMatches =
    row.status === "approved" &&
    row.url_hash === computeMcpUrlHash(row.url, row.auth_config as any);
  const healthy =
    row.enabled &&
    row.status === "approved" &&
    urlMatches &&
    approvedHashMatches;

  if (healthy) {
    return {
      serverId: row.id,
      installed: true,
      installAvailable: false,
      status: "installed",
      message: null,
    };
  }

  if (!row.enabled) {
    return {
      serverId: row.id,
      installed: true,
      installAvailable: canInstall,
      status: "disabled",
      message:
        "Twenty CRM MCP server is registered but disabled while the CRM runtime is parked.",
    };
  }

  if (!urlMatches || !approvedHashMatches) {
    return {
      serverId: row.id,
      installed: true,
      installAvailable: canInstall,
      status: "needs_repair",
      message: "Twenty CRM MCP server registration needs repair.",
    };
  }

  return {
    serverId: row.id,
    installed: true,
    installAvailable: canInstall,
    status: row.status,
    message: `Twenty CRM MCP server is ${row.status}.`,
  };
}

export async function reconcileTwentyManagedMcp(args: {
  tenantId: string;
  application: ManagedApplicationStatus;
  mode: "running" | "parked" | "destroyed";
  db?: DbLike;
  fetchImpl?: typeof fetch;
  secretsManager?: Pick<SecretsManagerClient, "send">;
}): Promise<ManagedMcpDeploymentState> {
  const db = args.db ?? defaultDb;

  if (args.mode === "destroyed") {
    await destroyTwentyManagedMcp(args.tenantId, db, args.secretsManager);
    return {
      serverId: null,
      installed: false,
      installAvailable: false,
      status: "removed",
      message: "Twenty CRM MCP server registration removed.",
    };
  }

  const existing = await loadManagedTwentyRow(args.tenantId, db);
  if (args.mode === "parked") {
    if (!existing) {
      return summarizeTwentyManagedMcpState(args.application, null);
    }
    await setManagedMcpEnabled(db, existing.id, false);
    await setManagedMcpAssignmentsEnabled(db, existing.id, false);
    return summarizeTwentyManagedMcpState(args.application, {
      ...existing,
      enabled: false,
    });
  }

  if (!args.application.url || !args.application.runtimeEnabled) {
    throw new GraphQLError("Twenty CRM must be running before MCP install", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const mcpUrl = twentyMcpUrlFromApplicationUrl(args.application.url);
  await assertTwentyMcpResourceMetadata(mcpUrl, args.fetchImpl ?? fetch);
  const authConfig = managedTwentyAuthConfig(mcpUrl);
  const urlHash = computeMcpUrlHash(mcpUrl, authConfig);

  if (!existing) {
    await ensureNoManualTwentySlug(args.tenantId, db);
    const [inserted] = (await db
      .insert(tenantMcpServers)
      .values({
        tenant_id: args.tenantId,
        name: TWENTY_MANAGED_MCP_NAME,
        slug: TWENTY_MANAGED_MCP_SLUG,
        url: mcpUrl,
        transport: "streamable-http",
        auth_type: "oauth",
        auth_config: authConfig,
        enabled: true,
        management_source: "managed_application",
        managed_application_key: TWENTY_MANAGED_MCP_KEY,
        status: "approved",
        url_hash: urlHash,
        approved_at: new Date(),
      })
      .returning({ id: tenantMcpServers.id })) as { id: string }[];
    await ensureManagedMcpDefaultAgentAssignments(
      db,
      args.tenantId,
      inserted.id,
    );
    return {
      serverId: inserted.id,
      installed: true,
      installAvailable: false,
      status: "installed",
      message: "Twenty CRM MCP server registered.",
    };
  }

  await db
    .update(tenantMcpServers)
    .set({
      name: TWENTY_MANAGED_MCP_NAME,
      slug: TWENTY_MANAGED_MCP_SLUG,
      url: mcpUrl,
      transport: "streamable-http",
      auth_type: "oauth",
      auth_config: authConfig,
      enabled: true,
      management_source: "managed_application",
      managed_application_key: TWENTY_MANAGED_MCP_KEY,
      status: "approved",
      url_hash: urlHash,
      approved_by: null,
      approved_at: new Date(),
      updated_at: new Date(),
    })
    .where(eq(tenantMcpServers.id, existing.id));
  await ensureManagedMcpDefaultAgentAssignments(db, args.tenantId, existing.id);
  await setManagedMcpAssignmentsEnabled(db, existing.id, true);

  return {
    serverId: existing.id,
    installed: true,
    installAvailable: false,
    status: "installed",
    message: "Twenty CRM MCP server registration repaired.",
  };
}

async function ensureManagedMcpDefaultAgentAssignments(
  db: DbLike,
  tenantId: string,
  serverId: string,
) {
  const platformAgents = (await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(eq(agents.tenant_id, tenantId), eq(agents.is_platform_default, true)),
    )) as { id: string }[];

  for (const agent of platformAgents) {
    await db
      .insert(agentMcpServers)
      .values({
        agent_id: agent.id,
        tenant_id: tenantId,
        mcp_server_id: serverId,
        enabled: true,
      })
      .onConflictDoUpdate({
        target: [agentMcpServers.agent_id, agentMcpServers.mcp_server_id],
        set: { enabled: true, updated_at: new Date() },
      });
  }
}

function applyManagedMcpState(
  application: ManagedApplicationStatus,
  state: ManagedMcpDeploymentState,
): ManagedApplicationStatus {
  return {
    ...application,
    managedMcpServerId: state.serverId,
    managedMcpStatus: state.status,
    managedMcpInstalled: state.installed,
    managedMcpInstallAvailable: state.installAvailable,
    managedMcpMessage: state.message,
  };
}

function managedTwentyAuthConfig(mcpUrl: string): Record<string, unknown> {
  return {
    oauth_resource: mcpUrl,
  };
}

async function loadManagedTwentyRow(
  tenantId: string,
  db: DbLike,
): Promise<ManagedMcpRow | null> {
  const [row] = (await db
    .select({
      id: tenantMcpServers.id,
      slug: tenantMcpServers.slug,
      url: tenantMcpServers.url,
      enabled: tenantMcpServers.enabled,
      status: tenantMcpServers.status,
      url_hash: tenantMcpServers.url_hash,
      auth_config: tenantMcpServers.auth_config,
      management_source: tenantMcpServers.management_source,
      managed_application_key: tenantMcpServers.managed_application_key,
    })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        eq(tenantMcpServers.managed_application_key, TWENTY_MANAGED_MCP_KEY),
      ),
    )
    .limit(1)) as ManagedMcpRow[];
  return row ?? null;
}

async function ensureNoManualTwentySlug(
  tenantId: string,
  db: DbLike,
): Promise<void> {
  const [manual] = (await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        eq(tenantMcpServers.slug, TWENTY_MANAGED_MCP_SLUG),
        eq(tenantMcpServers.management_source, "manual"),
      ),
    )
    .limit(1)) as { id: string }[];

  if (manual) {
    throw new GraphQLError(
      "A manual MCP server already uses the twenty-crm slug; rename it before installing the managed Twenty CRM MCP server.",
      { extensions: { code: "CONFLICT" } },
    );
  }
}

async function assertTwentyMcpResourceMetadata(
  mcpUrl: string,
  fetchImpl: typeof fetch,
): Promise<void> {
  const mcp = new URL(mcpUrl);
  const path = mcp.pathname.replace(/^\//, "");
  const metadataUrl = `${mcp.origin}/.well-known/oauth-protected-resource/${path}`;
  const response = await fetchImpl(metadataUrl, {
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) {
    throw new GraphQLError(
      `Twenty CRM MCP OAuth metadata discovery failed (${response.status})`,
      { extensions: { code: "BAD_GATEWAY" } },
    );
  }

  const metadata = (await response.json()) as {
    authorization_servers?: unknown;
  };
  if (
    !Array.isArray(metadata.authorization_servers) ||
    metadata.authorization_servers.length === 0
  ) {
    throw new GraphQLError(
      "Twenty CRM MCP OAuth metadata did not include an authorization server",
      { extensions: { code: "BAD_GATEWAY" } },
    );
  }
}

async function setManagedMcpEnabled(
  db: DbLike,
  serverId: string,
  enabled: boolean,
) {
  await db
    .update(tenantMcpServers)
    .set({ enabled, updated_at: new Date() })
    .where(eq(tenantMcpServers.id, serverId));
}

async function setManagedMcpAssignmentsEnabled(
  db: DbLike,
  serverId: string,
  enabled: boolean,
) {
  await db
    .update(agentMcpServers)
    .set({ enabled, updated_at: new Date() })
    .where(eq(agentMcpServers.mcp_server_id, serverId));
  await db
    .update(agentTemplateMcpServers)
    .set({ enabled, updated_at: new Date() })
    .where(eq(agentTemplateMcpServers.mcp_server_id, serverId));
  await db
    .update(spaceMcpServers)
    .set({ enabled, updated_at: new Date() })
    .where(eq(spaceMcpServers.mcp_server_id, serverId));
}

async function destroyTwentyManagedMcp(
  tenantId: string,
  db: DbLike,
  secretsManager?: Pick<SecretsManagerClient, "send">,
) {
  const existing = await loadManagedTwentyRow(tenantId, db);
  if (!existing) return;

  const tokens = (await db
    .select({ id: userMcpTokens.id, secret_ref: userMcpTokens.secret_ref })
    .from(userMcpTokens)
    .where(eq(userMcpTokens.mcp_server_id, existing.id))) as {
    id: string;
    secret_ref: string;
  }[];

  const sm =
    secretsManager ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  for (const token of tokens) {
    if (!token.secret_ref) continue;
    try {
      await sm.send(
        new DeleteSecretCommand({
          SecretId: token.secret_ref,
          ForceDeleteWithoutRecovery: true,
        }),
      );
    } catch (error) {
      console.warn(
        "[managed-mcp] Failed to delete Twenty MCP token secret:",
        (error as Error).message,
      );
    }
  }

  await db
    .delete(userMcpTokens)
    .where(eq(userMcpTokens.mcp_server_id, existing.id));
  await db
    .delete(tenantMcpContextTools)
    .where(eq(tenantMcpContextTools.mcp_server_id, existing.id));
  await db
    .delete(agentMcpServers)
    .where(eq(agentMcpServers.mcp_server_id, existing.id));
  await db
    .delete(agentTemplateMcpServers)
    .where(eq(agentTemplateMcpServers.mcp_server_id, existing.id));
  await db
    .delete(spaceMcpServers)
    .where(eq(spaceMcpServers.mcp_server_id, existing.id));
  await db
    .delete(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.id, existing.id),
        eq(tenantMcpServers.tenant_id, tenantId),
      ),
    );
}
