/**
 * Digital Twin MCP connector provisioning (THINK-333 U4).
 *
 * One idempotent ceremony per tenant, run when the twin is deployed (and
 * re-run harmlessly):
 *
 *   1. Mint a `tkt_` tenant key → SHA-256 hash row in tenant_mcp_twin_keys
 *      (revoke-before-insert on the same name, so re-runs rotate).
 *   2. Store the raw key in Secrets Manager at
 *      `thinkwork/<stage>/mcp/<tenantId>/digital-twin` as {token, tenantId}.
 *   3. Upsert the APPROVED `tenant_mcp_servers` row (slug `digital-twin`,
 *      stage `/mcp/twin` URL, streamable-http, service_credential auth
 *      whose auth_config holds ONLY the secret reference) with `url_hash`
 *      EXPLICITLY pinned — never the U11 NULL-grandfather branch. Mirrors
 *      the analyst connector (analyst/provision-connector.ts).
 *   4. Materialize `connectors/digital-twin/` into every non-archived agent
 *      workspace (default-on, R13) + the legacy `mcp/<slug>/.assignment.json`
 *      dual-write for non-folder-dispatch agents.
 *
 * Rotation IS a re-run: step 1 revokes the old key, steps 2-3 re-point the
 * secret + re-pin the hash in the same call, so agents never cross a
 * dead-credential window.
 */
import { createHash, randomBytes } from "node:crypto";
import { and, eq, isNull, sql } from "drizzle-orm";
import {
  agents,
  tenantMcpServers,
  tenantMcpTwinKeys,
} from "@thinkwork/database-pg/schema";

import { db as defaultDb } from "../../graphql/utils.js";
import { computeMcpUrlHash } from "../mcp-server-hash.js";
import {
  connectionDefinitionFromRegistryRow,
  putCapabilityFolder,
  type CapabilityFolderWriteDeps,
} from "../capabilities/folder-write.js";
import type { CapabilitySignedBy } from "../capabilities/sidecar-signing.js";
import {
  capabilityRegistryTrustEnabled,
  type RegistryBindingContext,
} from "../capabilities/registry-trust-flag.js";
import { resolveAgentWorkspacePrefix } from "../skills/assignment-state.js";
import { materializeMcpAssignmentFoldersForAgents } from "../mcp/assignment-state.js";

type DbLike = typeof defaultDb;

export const TWIN_CONNECTOR_SLUG = "digital-twin";
export const TWIN_CONNECTOR_NAME = "Digital Twin";
export const TWIN_KEY_NAME = "default";

/**
 * The grant's operations list IS the runtime tool whitelist: folder
 * dispatch maps `permissions.operations` -> `toolAllowlist` ->
 * mcp-connect's listTools filter. Name the server's actual tools here or
 * they are silently filtered after connect (the server shows "loaded"
 * with zero tools — burned on dev, 2026-07-22).
 */
export const TWIN_CONNECTOR_OPERATIONS = [
  "twin_describe_ontology",
  "twin_cypher",
  "twin_entity",
] as const;

/** `tkt_` distinguishes twin keys from admin-ops' `tkm_` at a glance. */
export function generateTwinKey(): { raw: string; hash: string } {
  const raw = `tkt_${randomBytes(32).toString("base64url")}`;
  return { raw, hash: hashTwinKey(raw) };
}

export function hashTwinKey(raw: string): string {
  return createHash("sha256").update(raw).digest("hex");
}

export function twinSecretName(stage: string, tenantId: string): string {
  return `thinkwork/${stage}/mcp/${tenantId}/digital-twin`;
}

/**
 * service_credential auth_config: secretRef only — dispatch resolves the
 * Bearer header from the secret's `token` key at config-build time
 * (resolveServiceCredentialAuth), so the raw key never lands in Postgres.
 */
export function twinConnectorAuthConfig(
  secretRef: string,
): Record<string, unknown> {
  return {
    secretRef,
    headers: [
      { name: "Authorization", secretJsonKey: "token", valuePrefix: "Bearer " },
    ],
  };
}

/** Full registry row values — born approved with the hash pinned. */
export function twinConnectorRowValues(input: {
  tenantId: string;
  twinMcpUrl: string;
  secretRef: string;
}) {
  const auth_config = twinConnectorAuthConfig(input.secretRef);
  return {
    tenant_id: input.tenantId,
    name: TWIN_CONNECTOR_NAME,
    slug: TWIN_CONNECTOR_SLUG,
    url: input.twinMcpUrl,
    transport: "streamable-http",
    auth_type: "service_credential",
    auth_config,
    enabled: true,
    management_source: "manual",
    status: "approved",
    url_hash: computeMcpUrlHash(input.twinMcpUrl, auth_config),
    approved_at: new Date(),
  };
}

/** Twin-specific prose appended to the generated CONNECTION.md. */
export const TWIN_CONNECTION_GUIDANCE = `
## Querying the digital twin

Call \`twin_describe_ontology\` FIRST — it returns this company's entity
types, facet properties (\`f_<facet>__<attribute>\`), relationship types,
and worked openCypher examples. Then answer cross-system questions with
\`twin_cypher\` (read-only openCypher; the server scopes every query to
this tenant and clamps rows). \`twin_entity\` fetches one entity by
canonical id with its source-system identities. Cite source systems when
the facets carry them; never guess entity ids.
`;

export interface TwinProvisionResult {
  tenantMcpServerId: string;
  keyId: string;
  secretRef: string;
  url: string;
  provisioned: "created" | "rotated";
  workspaces: {
    agents: number;
    skipped: Array<{ agentId: string; reason: string }>;
  };
}

export interface TwinProvisionDeps {
  db?: DbLike;
  /** Secrets Manager client seam (tests). */
  sm?: { send: (command: unknown) => Promise<{ ARN?: string }> };
  folderDeps?: CapabilityFolderWriteDeps;
  signedBy?: CapabilitySignedBy;
  now?: () => Date;
}

export async function provisionTwinConnector(
  input: {
    tenantId: string;
    /** Absolute /mcp/twin endpoint, e.g. https://<api-host>/mcp/twin */
    twinMcpUrl: string;
    stage: string;
    createdByUserId?: string | null;
  },
  deps: TwinProvisionDeps = {},
): Promise<TwinProvisionResult> {
  const db = deps.db ?? defaultDb;
  const now = deps.now ?? (() => new Date());
  const secretRef = twinSecretName(input.stage, input.tenantId);

  // 1. Rotate-safe key mint: revoke same-name active rows, insert fresh.
  const { raw, hash } = generateTwinKey();
  await db
    .update(tenantMcpTwinKeys)
    .set({ revoked_at: now() })
    .where(
      and(
        eq(tenantMcpTwinKeys.tenant_id, input.tenantId),
        eq(tenantMcpTwinKeys.name, TWIN_KEY_NAME),
        isNull(tenantMcpTwinKeys.revoked_at),
      ),
    );
  const [keyRow] = await db
    .insert(tenantMcpTwinKeys)
    .values({
      tenant_id: input.tenantId,
      key_hash: hash,
      name: TWIN_KEY_NAME,
      created_by_user_id: input.createdByUserId ?? null,
    })
    .returning({ id: tenantMcpTwinKeys.id });
  if (!keyRow) throw new Error("twin provision: key insert returned no row");

  // 2. Raw key to Secrets Manager (value shape resolveServiceCredentialAuth
  // binds: {token, tenantId}).
  await putTwinSecret(secretRef, raw, input.tenantId, deps.sm);

  // 3. Approved registry row with the hash pinned.
  const values = twinConnectorRowValues({
    tenantId: input.tenantId,
    twinMcpUrl: input.twinMcpUrl,
    secretRef,
  });
  const [existing] = await db
    .select({ id: tenantMcpServers.id })
    .from(tenantMcpServers)
    .where(
      and(
        eq(tenantMcpServers.tenant_id, input.tenantId),
        eq(tenantMcpServers.slug, TWIN_CONNECTOR_SLUG),
      ),
    )
    .limit(1);
  let tenantMcpServerId: string;
  let provisioned: "created" | "rotated";
  if (existing) {
    await db
      .update(tenantMcpServers)
      .set({ ...values, updated_at: now() })
      .where(eq(tenantMcpServers.id, existing.id));
    tenantMcpServerId = existing.id;
    provisioned = "rotated";
  } else {
    const [inserted] = await db
      .insert(tenantMcpServers)
      .values(values)
      .returning({ id: tenantMcpServers.id });
    if (!inserted)
      throw new Error("twin provision: server insert returned no row");
    tenantMcpServerId = inserted.id;
    provisioned = "created";
  }

  // 4. Default-on workspace materialization (R13).
  const workspaces = await materializeTwinConnectorFolder(
    { tenantId: input.tenantId, tenantMcpServerId },
    deps,
  );

  return {
    tenantMcpServerId,
    keyId: keyRow.id,
    secretRef,
    url: input.twinMcpUrl,
    provisioned,
    workspaces,
  };
}

async function putTwinSecret(
  secretRef: string,
  raw: string,
  tenantId: string,
  smOverride?: { send: (command: unknown) => Promise<{ ARN?: string }> },
): Promise<void> {
  const {
    SecretsManagerClient,
    CreateSecretCommand,
    UpdateSecretCommand,
    ResourceNotFoundException,
  } = await import("@aws-sdk/client-secrets-manager");
  const sm =
    smOverride ??
    new SecretsManagerClient({ region: process.env.AWS_REGION || "us-east-1" });
  const payload = JSON.stringify({ token: raw, tenantId });
  try {
    await sm.send(
      new UpdateSecretCommand({ SecretId: secretRef, SecretString: payload }),
    );
  } catch (err: unknown) {
    if (err instanceof ResourceNotFoundException) {
      await sm.send(
        new CreateSecretCommand({ Name: secretRef, SecretString: payload }),
      );
      return;
    }
    throw err;
  }
}

/**
 * Materialize `connectors/digital-twin/` into every non-archived agent
 * workspace + the `mcp/<slug>/.assignment.json` dual-write. Idempotent —
 * the folder write re-signs the same definition bytes.
 */
export async function materializeTwinConnectorFolder(
  input: { tenantId: string; tenantMcpServerId: string },
  deps: TwinProvisionDeps = {},
): Promise<TwinProvisionResult["workspaces"]> {
  const db = deps.db ?? defaultDb;
  const signedBy: CapabilitySignedBy =
    deps.signedBy ?? "operator:provision-twin-connector";

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
      `twin connector folder: registry row ${input.tenantMcpServerId} not found for tenant ${input.tenantId}`,
    );
  }
  if (row.status !== "approved") {
    throw new Error(
      `twin connector folder: registry row is ${row.status}, not approved`,
    );
  }

  const generated = connectionDefinitionFromRegistryRow(row);
  const definition = `${generated.definition}${TWIN_CONNECTION_GUIDANCE}`;
  const slug = generated.slug;

  const agentRows = await db
    .select({ id: agents.id })
    .from(agents)
    .where(
      and(
        eq(agents.tenant_id, input.tenantId),
        sql`${agents.status} <> 'archived'`,
      ),
    );

  const registryTrust = await capabilityRegistryTrustEnabled(
    db,
    input.tenantId,
  );

  const skipped: Array<{ agentId: string; reason: string }> = [];
  let written = 0;
  for (const agent of agentRows) {
    const targetPrefix = await resolveAgentWorkspacePrefix(agent.id);
    if (!targetPrefix) {
      skipped.push({ agentId: agent.id, reason: "no_workspace_prefix" });
      continue;
    }
    const rootRegistry: RegistryBindingContext | undefined = registryTrust
      ? {
          db,
          tenantId: input.tenantId,
          scopeRef: `agent:${agent.id}`,
          signedBy,
        }
      : undefined;
    const result = await putCapabilityFolder({
      targetPrefix,
      klass: "connection",
      slug,
      definition,
      sidecar: {
        enabled: true,
        permissions: { operations: [...TWIN_CONNECTOR_OPERATIONS] },
        config: { registryServerId: row.id },
      },
      signedBy,
      registry: rootRegistry,
      deps: deps.folderDeps,
    });
    if (!result.ok) {
      skipped.push({ agentId: agent.id, reason: result.reason });
      continue;
    }
    written += 1;
  }

  // Legacy dual-write so non-folder-dispatch agents resolve the server too
  // (mcp-configs.ts reads `mcp/<slug>/` attachment records; the helper
  // skips folder-dispatch-flipped agents internally).
  if (agentRows.length > 0) {
    await materializeMcpAssignmentFoldersForAgents(
      {
        agentIds: agentRows.map((agent) => agent.id),
        tenantId: input.tenantId,
        registryServerId: row.id,
      },
      deps.folderDeps,
    );
  }

  return { agents: written, skipped };
}
