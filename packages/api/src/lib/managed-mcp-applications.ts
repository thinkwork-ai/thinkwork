import {
  CreateSecretCommand,
  DeleteSecretCommand,
  ResourceNotFoundException,
  SecretsManagerClient,
  UpdateSecretCommand,
} from "@aws-sdk/client-secrets-manager";
import { GraphQLError } from "graphql";
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull } from "drizzle-orm";
import {
  agentMcpServers,
  agents,
  agentTemplateMcpServers,
  spaceMcpServers,
  tenantMcpAdminKeys,
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
export const KESTRA_MANAGED_MCP_KEY = "kestra";
export const KESTRA_MANAGED_MCP_SLUG = "kestra-control";
export const KESTRA_MANAGED_MCP_NAME = "Kestra";
const KESTRA_ADMIN_KEY_NAME = "kestra-control";

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
      if (application.key !== "twenty" && application.key !== "kestra") {
        return application;
      }
      const state =
        application.key === "twenty"
          ? await readTwentyManagedMcpState(tenantId, application, db)
          : await readKestraManagedMcpState(tenantId, application, db);
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

export async function readKestraManagedMcpState(
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
        eq(tenantMcpServers.managed_application_key, KESTRA_MANAGED_MCP_KEY),
      ),
    )
    .limit(1)) as ManagedMcpRow[];

  return summarizeKestraManagedMcpState(application, row ?? null);
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

export function summarizeKestraManagedMcpState(
  application: ManagedApplicationStatus,
  row: ManagedMcpRow | null,
): ManagedMcpDeploymentState {
  const expectedUrl = kestraControlMcpUrl();
  const canInstall =
    application.key === "kestra" &&
    application.status === "running" &&
    application.runtimeEnabled &&
    Boolean(application.url) &&
    Boolean(expectedUrl);

  if (!row) {
    return {
      serverId: null,
      installed: false,
      installAvailable: canInstall,
      status: canInstall ? "missing" : "not_ready",
      message: canInstall
        ? "Kestra control MCP server has not been registered yet."
        : "Kestra control MCP registration requires the runtime and ThinkWork API URL.",
    };
  }

  const authConfig = row.auth_config as Record<string, unknown> | null;
  const urlMatches = !expectedUrl || row.url === expectedUrl;
  const secretConfigured =
    authConfig !== null && typeof authConfig?.secretRef === "string";
  const approvedHashMatches =
    row.status === "approved" &&
    row.url_hash === computeMcpUrlHash(row.url, authConfig);
  const healthy =
    row.enabled &&
    row.status === "approved" &&
    urlMatches &&
    secretConfigured &&
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
        "Kestra control MCP server is registered but disabled while the Kestra runtime is parked.",
    };
  }

  if (!urlMatches || !secretConfigured || !approvedHashMatches) {
    return {
      serverId: row.id,
      installed: true,
      installAvailable: canInstall,
      status: "needs_repair",
      message: "Kestra control MCP server registration needs repair.",
    };
  }

  return {
    serverId: row.id,
    installed: true,
    installAvailable: canInstall,
    status: row.status,
    message: `Kestra control MCP server is ${row.status}.`,
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

export async function reconcileKestraManagedMcp(args: {
  tenantId: string;
  application: ManagedApplicationStatus;
  mode: "running" | "parked" | "destroyed";
  db?: DbLike;
  secretsManager?: Pick<SecretsManagerClient, "send">;
}): Promise<ManagedMcpDeploymentState> {
  const db = args.db ?? defaultDb;
  const sm =
    args.secretsManager ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });

  if (args.mode === "destroyed") {
    await destroyKestraManagedMcp(args.tenantId, db, sm);
    return {
      serverId: null,
      installed: false,
      installAvailable: false,
      status: "removed",
      message: "Kestra control MCP server registration removed.",
    };
  }

  const existing = await loadManagedKestraRow(args.tenantId, db);
  if (args.mode === "parked") {
    if (!existing) {
      return summarizeKestraManagedMcpState(args.application, null);
    }
    await setManagedMcpEnabled(db, existing.id, false);
    await setManagedMcpAssignmentsEnabled(db, existing.id, false);
    return summarizeKestraManagedMcpState(args.application, {
      ...existing,
      enabled: false,
    });
  }

  if (!args.application.url || !args.application.runtimeEnabled) {
    throw new GraphQLError("Kestra must be running before MCP install", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const mcpUrl = kestraControlMcpUrl();
  if (!mcpUrl) {
    throw new GraphQLError(
      "THINKWORK_API_URL or MCP_CUSTOM_DOMAIN is required before Kestra MCP install",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  await ensureNoManualKestraSlug(args.tenantId, db);
  const existingAuthConfig =
    (existing?.auth_config as Record<string, unknown> | null) || {};
  const existingSecretRef =
    typeof existingAuthConfig.secretRef === "string" &&
    existingAuthConfig.secretRef.trim()
      ? existingAuthConfig.secretRef.trim()
      : null;
  const secretRef =
    existingSecretRef ??
    (await ensureKestraControlBearerSecret(args.tenantId, db, sm));
  const authConfig = { secretRef };
  const urlHash = computeMcpUrlHash(mcpUrl, authConfig);

  if (!existing) {
    const [inserted] = (await db
      .insert(tenantMcpServers)
      .values({
        tenant_id: args.tenantId,
        name: KESTRA_MANAGED_MCP_NAME,
        slug: KESTRA_MANAGED_MCP_SLUG,
        url: mcpUrl,
        transport: "streamable-http",
        auth_type: "tenant_api_key",
        auth_config: authConfig,
        enabled: true,
        management_source: "managed_application",
        managed_application_key: KESTRA_MANAGED_MCP_KEY,
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
      message: "Kestra control MCP server registered.",
    };
  }

  await db
    .update(tenantMcpServers)
    .set({
      name: KESTRA_MANAGED_MCP_NAME,
      slug: KESTRA_MANAGED_MCP_SLUG,
      url: mcpUrl,
      transport: "streamable-http",
      auth_type: "tenant_api_key",
      auth_config: authConfig,
      enabled: true,
      management_source: "managed_application",
      managed_application_key: KESTRA_MANAGED_MCP_KEY,
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
    message: "Kestra control MCP server registration repaired.",
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

async function loadManagedKestraRow(
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
        eq(tenantMcpServers.managed_application_key, KESTRA_MANAGED_MCP_KEY),
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

async function ensureNoManualKestraSlug(
  tenantId: string,
  db: DbLike,
): Promise<void> {
  const [manual] = (await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, tenantId),
        eq(tenantMcpServers.slug, KESTRA_MANAGED_MCP_SLUG),
        eq(tenantMcpServers.management_source, "manual"),
      ),
    )
    .limit(1)) as { id: string }[];

  if (manual) {
    throw new GraphQLError(
      "A manual MCP server already uses the kestra-control slug; rename it before installing the managed Kestra control MCP server.",
      { extensions: { code: "CONFLICT" } },
    );
  }
}

function kestraControlMcpUrl(): string | null {
  const custom = process.env.MCP_CUSTOM_DOMAIN;
  if (custom) {
    return `https://${custom.replace(/^https?:\/\//, "").replace(/\/+$/, "")}/mcp/kestra`;
  }
  const apiUrl = process.env.THINKWORK_API_URL || process.env.MCP_BASE_URL;
  if (!apiUrl) return null;
  return `${apiUrl.replace(/\/+$/, "")}/mcp/kestra`;
}

function kestraControlBearerSecretName(tenantId: string): string {
  const stage = process.env.STAGE || "dev";
  return `thinkwork/${stage}/mcp/${tenantId}/${KESTRA_MANAGED_MCP_SLUG}`;
}

async function ensureKestraControlBearerSecret(
  tenantId: string,
  db: DbLike,
  secretsManager: Pick<SecretsManagerClient, "send">,
): Promise<string> {
  await db
    .update(tenantMcpAdminKeys)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(tenantMcpAdminKeys.tenant_id, tenantId),
        eq(tenantMcpAdminKeys.name, KESTRA_ADMIN_KEY_NAME),
        isNull(tenantMcpAdminKeys.revoked_at),
      ),
    );

  const raw = `tkm_${randomBytes(32).toString("base64url")}`;
  const hash = createHash("sha256").update(raw).digest("hex");
  await db.insert(tenantMcpAdminKeys).values({
    tenant_id: tenantId,
    key_hash: hash,
    name: KESTRA_ADMIN_KEY_NAME,
  });

  const secretName = kestraControlBearerSecretName(tenantId);
  const payload = JSON.stringify({ type: "mcpApiKey", token: raw });
  try {
    await secretsManager.send(
      new UpdateSecretCommand({ SecretId: secretName, SecretString: payload }),
    );
  } catch (error) {
    if (error instanceof ResourceNotFoundException) {
      await secretsManager.send(
        new CreateSecretCommand({ Name: secretName, SecretString: payload }),
      );
    } else {
      throw error;
    }
  }
  return secretName;
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

async function destroyKestraManagedMcp(
  tenantId: string,
  db: DbLike,
  secretsManager: Pick<SecretsManagerClient, "send">,
) {
  const existing = await loadManagedKestraRow(tenantId, db);
  if (!existing) return;

  const authConfig = (existing.auth_config as Record<string, unknown>) || {};
  const secretRef =
    typeof authConfig.secretRef === "string" ? authConfig.secretRef : null;

  await deleteSecretIfPresent(
    secretsManager,
    secretRef,
    "[managed-mcp] Failed to delete Kestra control MCP bearer secret:",
  );
  await deleteSecretIfPresent(
    secretsManager,
    kestraBasicAuthSecretRef(),
    "[managed-mcp] Failed to delete Kestra service credential secret:",
  );

  await db
    .update(tenantMcpAdminKeys)
    .set({ revoked_at: new Date() })
    .where(
      and(
        eq(tenantMcpAdminKeys.tenant_id, tenantId),
        eq(tenantMcpAdminKeys.name, KESTRA_ADMIN_KEY_NAME),
        isNull(tenantMcpAdminKeys.revoked_at),
      ),
    );

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

async function deleteSecretIfPresent(
  secretsManager: Pick<SecretsManagerClient, "send">,
  secretRef: string | null,
  logMessage: string,
) {
  if (!secretRef) return;
  try {
    await secretsManager.send(
      new DeleteSecretCommand({
        SecretId: secretRef,
        ForceDeleteWithoutRecovery: true,
      }),
    );
  } catch (error) {
    console.warn(logMessage, (error as Error).message);
  }
}

function kestraBasicAuthSecretRef(): string | null {
  const raw = process.env.KESTRA || process.env.KESTRA_STATUS;
  if (raw) {
    const ref = raw.split("|")[8]?.trim();
    if (ref) return ref;
  }
  const explicit =
    process.env.KESTRA_BASIC_AUTH_SECRET_ARN ||
    process.env.KESTRA_SERVICE_CREDENTIAL_SECRET_ARN ||
    null;
  if (explicit) return explicit;

  const provisioned = raw
    ? raw.split("|")[0]?.trim() === "1" ||
      raw.split("|")[0]?.trim().toLowerCase() === "true"
    : process.env.KESTRA_PROVISIONED?.toLowerCase() === "true" ||
      process.env.KESTRA_PROVISIONED === "1";
  if (!provisioned) return null;

  const stage = process.env.STAGE || "dev";
  return `thinkwork/${stage}/kestra/basic-auth`;
}
