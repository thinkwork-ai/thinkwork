/**
 * registerInternalAnalystDataSource (THINK-239).
 *
 * Registers a database on an INTERNAL (environment-owned) RDS cluster as an
 * analyst connector with ZERO credential entry. Requires tenant owner/admin.
 *
 * Ceremony order (fail early; no writes before the reader posture is proven):
 *   1. validateInternalRegisterInput  — slug/database shape (BAD_USER_INPUT)
 *   2. resolve cluster + confirm the database exists on it (BAD_USER_INPUT)
 *   3. assertSlugAvailable             — slug free for this tenant (CONFLICT)
 *   4. auto-provision the hardened read-only role on cluster+database
 *   5. probeAndModelExternalSource     — connect AS the reader, verify read-only
 *   6. writeSourceCredentialSecret     — per-source reader credential
 *   7. writeSourceModelToS3            — model.json + SCHEMA.md
 *   8. insertExternalSourceRow         — born-approved tenant_mcp_servers row
 *   9. (retired U11) profile tool_policy union — the analyst grant is the
 *      signed agents/analyst/connectors/<slug>/ child folder (step below)
 *  10. materializeAnalystConnectionFolder — signed connections/<slug>/ folder
 *
 * Steps 5–10 reuse register-data-source.ts verbatim (the external ceremony);
 * this resolver only adds the cluster resolution + role auto-provisioning that
 * replace caller-supplied credentials.
 */

import { GraphQLError } from "graphql";
import { getConfig } from "@thinkwork/runtime-config";
import { renderStoredAnalystSchemaMarkdown } from "@thinkwork/database-pg/analyst";

import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { materializeAnalystConnectionFolder } from "../../../lib/analyst/connection-folder.js";
import { ensureAnalystBrokerSecretValue } from "../../../lib/analyst/provision-connector.js";
import {
  AnalystRegistrationConflictError,
  AnalystRegistrationInputError,
  AnalystRegistrationPostureError,
  analystSourceCredentialSecretName,
  assertSlugAvailable,
  insertExternalSourceRow,
  probeAndModelExternalSource,
  resolveTenantSlug,
  writeSourceCredentialSecret,
  writeSourceModelToS3,
  type NormalizedRegisterInput,
} from "../../../lib/analyst/register-data-source.js";
import {
  validateInternalRegisterInput,
  type RegisterInternalAnalystDataSourceInput,
} from "../../../lib/analyst/register-internal-data-source.js";
import {
  describeInternalClusters,
  enumerateDatabases,
  openAdminClient,
  resolveAdminCredential,
  resolveStage,
} from "../../../lib/analyst/internal-clusters.js";
import {
  generateReaderPassword,
  provisionReaderRole,
  readerRoleName,
} from "../../../lib/analyst/provision-reader-role.js";
import type { AnalystDataSourceResult } from "./registerAnalystDataSource.mutation.js";
import type { CapabilitySignedBy } from "../../../lib/capabilities/sidecar-signing.js";

function cfg(key: string): string | undefined {
  try {
    return getConfig(key) || undefined;
  } catch {
    return undefined;
  }
}

/** Absolute API base the sourced broker URL hangs off, e.g. https://<host>. */
function resolveApiBase(): string | undefined {
  const explicit = cfg("THINKWORK_API_URL");
  if (explicit) return explicit.replace(/\/+$/, "");
  const brokerUrl = cfg("ANALYST_BROKER_URL");
  if (brokerUrl)
    return brokerUrl.replace(/\/+$/, "").replace(/\/mcp\/analyst$/, "");
  return undefined;
}

export const registerInternalAnalystDataSource = async (
  _parent: unknown,
  args: { input: RegisterInternalAnalystDataSourceInput },
  ctx: GraphQLContext,
): Promise<AnalystDataSourceResult> => {
  const { userId, tenantId } = await resolveCaller(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);

  // 1. Validate + normalize the input (slug/database shape; rejects `thinkwork`).
  let input;
  try {
    input = validateInternalRegisterInput(args.input);
  } catch (err) {
    if (err instanceof AnalystRegistrationInputError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  }

  // Resolve broker + storage config up front so a misconfigured stage fails
  // before we touch any cluster.
  const apiBase = resolveApiBase();
  const brokerSecretRef = cfg("ANALYST_BROKER_SECRET_ARN");
  const bucket = cfg("WORKSPACE_BUCKET");
  const missing: string[] = [];
  if (!apiBase) missing.push("THINKWORK_API_URL (or ANALYST_BROKER_URL)");
  if (!brokerSecretRef) missing.push("ANALYST_BROKER_SECRET_ARN");
  if (!bucket) missing.push("WORKSPACE_BUCKET");
  if (missing.length > 0) {
    throw new GraphQLError(
      `registerInternalAnalystDataSource: missing platform config: ${missing.join(", ")}. Nothing was written.`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  // The broker credential must HOLD A VALUE, not merely exist — Terraform
  // only creates the empty shell, and a source registered against a
  // version-less secret is silently withheld at every dispatch
  // (credential_missing). Mint on first use; never touch an existing value.
  try {
    await ensureAnalystBrokerSecretValue({
      secretRef: brokerSecretRef!,
      tenantId,
    });
  } catch (err) {
    throw new GraphQLError(
      `registerInternalAnalystDataSource: the analyst broker credential (${brokerSecretRef}) is unusable: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  const stage = resolveStage();

  // 2. Resolve the target cluster + the master credential, then confirm the
  //    requested database exists on it.
  const clusters = await describeInternalClusters(stage);
  const cluster = clusters.find((c) => c.clusterId === input.clusterId);
  if (!cluster) {
    throw new GraphQLError(
      `internal cluster "${input.clusterId}" was not found in this environment`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  const admin = await resolveAdminCredential(stage);
  if (!admin) {
    throw new GraphQLError(
      `no admin credential is available for cluster "${input.clusterId}" — cannot auto-provision a reader role`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  const databases = await enumerateDatabases(cluster, admin);
  if (!databases.includes(input.database)) {
    throw new GraphQLError(
      `database "${input.database}" was not found on cluster "${input.clusterId}"`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  // 3. Slug must be free for this tenant.
  try {
    await assertSlugAvailable({ tenantId, slug: input.slug });
  } catch (err) {
    if (err instanceof AnalystRegistrationConflictError) {
      throw new GraphQLError(err.message, { extensions: { code: "CONFLICT" } });
    }
    throw err;
  }

  // 4. Auto-provision the hardened read-only role on cluster+database, scoped
  //    to the ONE selected schema (THINK-283). The provisioner validates the
  //    schema against the live catalog before any role mutation, so a
  //    missing/empty schema fails here with nothing written anywhere.
  const roleName = readerRoleName(input.slug);
  const password = generateReaderPassword();
  const adminClient = await openAdminClient({
    host: cluster.endpoint,
    port: cluster.port,
    database: input.database,
    credential: admin,
  });
  try {
    await provisionReaderRole({
      client: adminClient,
      database: input.database,
      roleName,
      password,
      schema: input.schema,
    });
  } catch (err) {
    if (
      err instanceof AnalystRegistrationInputError ||
      err instanceof AnalystRegistrationPostureError
    ) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  } finally {
    try {
      await adminClient.end();
    } catch {
      // best-effort close
    }
  }

  // The auto-provisioned credential drives the rest of the (external) ceremony.
  const normalized: NormalizedRegisterInput = {
    name: input.name,
    slug: input.slug,
    host: cluster.endpoint,
    port: cluster.port,
    database: input.database,
    dbUser: roleName,
    password,
    tls: "required",
    schema: input.schema,
  };

  // 5. Connect AS the reader, verify read-only posture, introspect the surface.
  let model;
  try {
    model = await probeAndModelExternalSource(normalized);
  } catch (err) {
    if (err instanceof AnalystRegistrationPostureError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw new GraphQLError(
      `registerInternalAnalystDataSource: could not connect to the provisioned reader: ${err instanceof Error ? err.message : String(err)}`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  // 6. Per-source reader credential secret.
  const secretName = analystSourceCredentialSecretName({
    tenantId,
    slug: input.slug,
  });
  const credentialSecretArn = await writeSourceCredentialSecret({
    secretName,
    password,
    dbUser: roleName,
    host: cluster.endpoint,
  });

  // 7. model.json + rendered SCHEMA.md to S3.
  const tenantSlug = await resolveTenantSlug(tenantId);
  const schemaMarkdown = renderStoredAnalystSchemaMarkdown(model, {
    sourceName: input.name,
  });
  await writeSourceModelToS3({
    bucket: bucket!,
    tenantSlug,
    slug: input.slug,
    model,
    schemaMarkdown,
  });

  // 8. Born-approved registry row. Internal routing metadata (kind +
  //    clusterId) and the initial source generation ride in
  //    runtime_metadata.analyst_source so refresh can find its way back to
  //    the control plane (THINK-283).
  const { id: serverId } = await insertExternalSourceRow({
    tenantId,
    input: normalized,
    apiBase: apiBase!,
    brokerSecretRef: brokerSecretRef!,
    credentialSecretArn,
    source: { kind: "internal", clusterId: input.clusterId },
  });

  // 9. Materialize the signed connections/<slug>/ folder into every agent.
  const signer = ctx.auth.email || userId || "unknown";
  const signedBy: CapabilitySignedBy = `operator:${signer}`;
  const folder = await materializeAnalystConnectionFolder({
    tenantId,
    tenantMcpServerId: serverId,
    schemaMarkdown,
    signedBy,
  });

  return {
    serverId,
    slug: input.slug,
    tables: model.tables.length,
    foldersWritten: folder.agents,
    foldersSkipped: folder.skipped.length,
  };
};
