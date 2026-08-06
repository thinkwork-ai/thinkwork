/**
 * Company Brain MCP connector provisioning (THINK-333 U4).
 *
 * One idempotent ceremony per tenant, run when the twin is deployed (and
 * re-run harmlessly):
 *
 *   1. Mint a `tkt_` tenant key → SHA-256 hash row in tenant_mcp_twin_keys
 *      (revoke-before-insert on the same name, so re-runs rotate). The
 *      row carries the wildcard grants (`["*"]`) — see TWIN_KEY_ALL_GRANTS.
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
 *   5. Publish the hashed-key manifest to the brain-artifacts bucket
 *      (twin-mcp-keys/<tenantId>/latest.json, U12 KTD amendment) — during
 *      rotation the outgoing hash is published alongside the new one
 *      (step 1b grace publish) before the active-only final publish, so
 *      the platform verifier never sees zero valid keys mid-rotation.
 *      Publish failure never blocks the ceremony; it surfaces in
 *      `result.keyManifest`.
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
import {
  publishTwinKeyManifest,
  TWIN_KEY_GRANT_WILDCARD,
  type PublishTwinKeyManifestOptions,
  type TwinKeyManifestEntry,
} from "./key-manifest.js";

type DbLike = typeof defaultDb;

export const TWIN_CONNECTOR_SLUG = "digital-twin";
export const TWIN_CONNECTOR_NAME = "Company Brain";
export const TWIN_KEY_NAME = "default";

/**
 * Grant lists for the provisioned connector key: `["*"]` = every security
 * group, every KB collection (twin-mcp-keys/v2). This key backs the
 * console's own proxy, so it is deliberately exempt from the per-key
 * restrictions user-minted keys can carry.
 */
export const TWIN_KEY_ALL_GRANTS = [TWIN_KEY_GRANT_WILDCARD] as const;

/**
 * The grant's operations list IS the runtime tool whitelist: folder
 * dispatch maps `permissions.operations` -> `toolAllowlist` ->
 * mcp-connect's listTools filter. Name the server's actual tools here or
 * they are silently filtered after connect (the server shows "loaded"
 * with zero tools — burned on dev, 2026-07-22).
 */
export const TWIN_CONNECTOR_OPERATIONS = [
  "brain_search",
  "brain_ask",
  "brain_ask_submit",
  "brain_ask_result",
  "brain_capabilities",
  "brain_counts",
  "brain_describe_entity",
] as const;

/**
 * Deliberately absent from the list above (THINK-629):
 *
 *  - `brain_cypher` / `brain_describe_ontology` — the raw query surface and
 *    the schema-addressing doc that exists to author against it. Both are
 *    operator-only server-side under the retrieval-agent cutover, so an
 *    end-user agent that named them would list tools the Brain refuses.
 *    Graph questions go through `brain_ask`, which plans retrieval
 *    server-side and cites what it used.
 *  - `brain_describe_property` / `brain_search_meaning` /
 *    `brain_provenance_of` — catalog-authoring aides that only pay for
 *    themselves while hand-writing openCypher. With the query surface gone
 *    they are context cost, not capability.
 */

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

/**
 * Runtime metadata for the provisioned Brain connector row — the only
 * writer of `tenant_mcp_servers.runtime_metadata` on this manual (non-
 * plugin) row, and the reason `toMcpServerConfig` reads `longRunning`
 * ungated by plugin provenance.
 *
 *  - `longRunning` (THINK-623): Brain's deep-retrieval tools routinely run
 *    past the fixed 60s callTool wall; the long-call profile swaps it for
 *    progress-reset + a total-timeout budget.
 *  - `onBehalfOf` (THINK-626): opt this server into per-call
 *    `_meta["thinkwork.io/on_behalf_of"]`, so the Brain scopes the call to
 *    the signed-in human's own claims instead of the connector key's
 *    wildcard grants. Opt-in per server — never a blanket runtime default,
 *    because asserting an identity at a server that does not expect one is
 *    an unreviewed disclosure of who is asking.
 *
 * Re-provisioning rewrites this key, so both opt-ins survive a reinstall.
 */
export const TWIN_CONNECTOR_RUNTIME_METADATA = {
  longRunning: true,
  onBehalfOf: true,
} as const;

/** Full registry row values — born approved with the hash pinned. */
export function twinConnectorRowValues(input: {
  tenantId: string;
  twinMcpUrl: string;
  secretRef: string;
}) {
  const auth_config = twinConnectorAuthConfig(input.secretRef);
  return {
    runtime_metadata: { ...TWIN_CONNECTOR_RUNTIME_METADATA },
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
## Querying the company brain

Two lanes. Route on the question, not on habit.

**Knowledge, document, and policy questions** — "what does our handbook
say", "how do we handle X", "find the contract clause about Y": call
\`brain_search\` directly and answer from the excerpts it returns. It is
reranked and cited server-side with no agent loop in the way, so it is
both the fastest and the highest-fidelity lane for documents. Never route
a pure document question through \`brain_ask\`.

**Graph and data questions** — counts, lookups, rankings, relationships
between records across source systems: call \`brain_ask\` with the question
in plain language. It plans retrieval server-side and cites what it used;
you do not write queries. Pass the \`context_id\` it returns back on a
follow-up about the same topic.

**Deep multi-hop asks** that may outlive this call: \`brain_ask_submit\`,
then poll \`brain_ask_result\` with the task id.

Unsure whether this brain covers the subject at all? Call
\`brain_capabilities\` once — it lists the entity types, populations, and
knowledge collections your access can reach. \`brain_counts\` gives
populations alone; \`brain_describe_entity\` explains ONE entity type's
properties with source, authority, and freshness.

Cite source systems when the results carry them; never guess entity ids.
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
  /**
   * Hashed-key manifest publish outcome (U12 KTD amendment). Publish
   * failure never blocks provisioning — it surfaces here instead.
   */
  keyManifest: { published: boolean; errors: string[] };
}

export interface TwinProvisionDeps {
  db?: DbLike;
  /** Secrets Manager client seam (tests). */
  sm?: { send: (command: unknown) => Promise<{ ARN?: string }> };
  folderDeps?: CapabilityFolderWriteDeps;
  signedBy?: CapabilitySignedBy;
  now?: () => Date;
  /** S3 seam for the key-manifest publisher (tests). */
  manifestS3?: PublishTwinKeyManifestOptions["s3"];
  manifestBucket?: string;
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
  // Capture the outgoing active hashes FIRST — the U12 KTD amendment
  // requires BOTH hashes live in the published manifest mid-rotation.
  const outgoingRows = await db
    .select({
      id: tenantMcpTwinKeys.id,
      key_hash: tenantMcpTwinKeys.key_hash,
      name: tenantMcpTwinKeys.name,
      created_at: tenantMcpTwinKeys.created_at,
      security_groups: tenantMcpTwinKeys.security_groups,
      kb_collections: tenantMcpTwinKeys.kb_collections,
      trusted_subsystem: tenantMcpTwinKeys.trusted_subsystem,
    })
    .from(tenantMcpTwinKeys)
    .where(
      and(
        eq(tenantMcpTwinKeys.tenant_id, input.tenantId),
        isNull(tenantMcpTwinKeys.revoked_at),
      ),
    );
  // Grace entries carry the outgoing row's grants verbatim — a key that
  // is still valid for the cache window must not silently change what it
  // can see while it is being rotated out.
  const outgoingKeys: TwinKeyManifestEntry[] = outgoingRows.map((row) => ({
    keyHash: row.key_hash,
    keyId: row.id,
    name: row.name,
    createdAt: row.created_at ? row.created_at.toISOString() : null,
    securityGroups: row.security_groups ?? [],
    kbCollections: row.kb_collections ?? [],
    ...(row.trusted_subsystem ? { trustedSubsystem: true as const } : {}),
  }));

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
      // The platform-managed connector key is the console's own proxy
      // credential: it is minted with the wildcard grant so future
      // per-key restrictions can never narrow what the console sees.
      security_groups: [...TWIN_KEY_ALL_GRANTS],
      kb_collections: [...TWIN_KEY_ALL_GRANTS],
      // THINK-626: this is the ONE key the platform itself holds — the Pi
      // runtime's connector credential — so it is the only key allowed to
      // assert `on_behalf_of` and run a tools/call under the signed-in
      // human's own user-claims entry. Every user-minted key stays false.
      trusted_subsystem: true,
      created_by_user_id: input.createdByUserId ?? null,
    })
    .returning({ id: tenantMcpTwinKeys.id });
  if (!keyRow) throw new Error("twin provision: key insert returned no row");

  // 1b. Rotation grace publish: manifest = new active key + the outgoing
  // hashes carried as grace entries, so the platform (≤60s manifest cache)
  // accepts both keys while the secret repoint propagates. Never blocks
  // the ceremony — failures collect into result.keyManifest.
  const manifestErrors: string[] = [];
  const manifestOpts: PublishTwinKeyManifestOptions = {
    db,
    s3: deps.manifestS3,
    bucket: deps.manifestBucket,
    now,
  };
  if (outgoingKeys.length > 0) {
    const grace = await publishTwinKeyManifest(input.tenantId, {
      ...manifestOpts,
      extraKeys: outgoingKeys,
    });
    if (!grace.published) {
      manifestErrors.push(`grace publish failed: ${grace.reason}`);
    }
  }

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

  // 5. Final manifest publish: ACTIVE keys only — drops the rotated-out
  // hash; the platform's ≤60s cache is the revocation overlap window.
  const finalPublish = await publishTwinKeyManifest(
    input.tenantId,
    manifestOpts,
  );
  if (!finalPublish.published) {
    manifestErrors.push(`publish failed: ${finalPublish.reason}`);
  }

  return {
    tenantMcpServerId,
    keyId: keyRow.id,
    secretRef,
    url: input.twinMcpUrl,
    provisioned,
    workspaces,
    keyManifest: {
      published: finalPublish.published,
      errors: manifestErrors,
    },
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
