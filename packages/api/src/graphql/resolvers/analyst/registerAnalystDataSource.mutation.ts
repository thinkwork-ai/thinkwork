/**
 * registerAnalystDataSource (THINK-239).
 *
 * Operator-facing GraphQL entry point that registers an EXTERNAL Postgres
 * data source as a first-party analyst connector — the multi-source
 * generalization of provisionAnalystConnector (THINK-230, builtin
 * `postgres-dev` only). Requires tenant owner/admin, same as
 * provisionAnalystConnector.
 *
 * Ceremony order (fail early; no partial writes before the source is proven
 * read-only):
 *   1. validateRegisterInput        — slug/host/port/... shape (BAD_USER_INPUT)
 *   2. assertSlugAvailable          — slug free for this tenant (CONFLICT)
 *   3. probeAndModelExternalSource  — connect + verify read-only + introspect
 *   4. writeSourceCredentialSecret  — per-source reader credential
 *   5. writeSourceModelToS3         — model.json + SCHEMA.md
 *   6. insertExternalSourceRow      — born-approved tenant_mcp_servers row
 *   7. appendSourceToAnalystProfile — union the slug into tool_policy.mcpServers
 *   8. materializeAnalystConnectionFolder — signed connections/<slug>/ folder
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
  appendSourceToAnalystProfile,
  assertSlugAvailable,
  insertExternalSourceRow,
  probeAndModelExternalSource,
  resolveTenantSlug,
  validateRegisterInput,
  writeSourceCredentialSecret,
  writeSourceModelToS3,
  type RegisterAnalystDataSourceInput,
} from "../../../lib/analyst/register-data-source.js";
import type { CapabilitySignedBy } from "../../../lib/capabilities/sidecar-signing.js";

export interface AnalystDataSourceResult {
  serverId: string;
  slug: string;
  tables: number;
  foldersWritten: number;
  foldersSkipped: number;
}

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
  // Fallback: strip the /mcp/analyst suffix off the configured broker URL.
  const brokerUrl = cfg("ANALYST_BROKER_URL");
  if (brokerUrl)
    return brokerUrl.replace(/\/+$/, "").replace(/\/mcp\/analyst$/, "");
  return undefined;
}

export const registerAnalystDataSource = async (
  _parent: unknown,
  args: { input: RegisterAnalystDataSourceInput },
  ctx: GraphQLContext,
): Promise<AnalystDataSourceResult> => {
  const { userId, tenantId } = await resolveCaller(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  await requireTenantAdmin(ctx, tenantId);

  // 1. Validate + normalize the input.
  let input;
  try {
    input = validateRegisterInput(args.input);
  } catch (err) {
    if (err instanceof AnalystRegistrationInputError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw err;
  }

  // Resolve broker + storage config up front so a misconfigured stage fails
  // before we touch the external source.
  const apiBase = resolveApiBase();
  const brokerSecretRef = cfg("ANALYST_BROKER_SECRET_ARN");
  const bucket = cfg("WORKSPACE_BUCKET");
  const missing: string[] = [];
  if (!apiBase) missing.push("THINKWORK_API_URL (or ANALYST_BROKER_URL)");
  if (!brokerSecretRef) missing.push("ANALYST_BROKER_SECRET_ARN");
  if (!bucket) missing.push("WORKSPACE_BUCKET");
  if (missing.length > 0) {
    throw new GraphQLError(
      `registerAnalystDataSource: missing platform config: ${missing.join(", ")}. Nothing was written.`,
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
      `registerAnalystDataSource: the analyst broker credential (${brokerSecretRef}) is unusable: ${err instanceof Error ? err.message : String(err)}. Nothing was written.`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  // 2. Slug must be free for this tenant.
  try {
    await assertSlugAvailable({ tenantId, slug: input.slug });
  } catch (err) {
    if (err instanceof AnalystRegistrationConflictError) {
      throw new GraphQLError(err.message, { extensions: { code: "CONFLICT" } });
    }
    throw err;
  }

  // 3. Connect with the supplied credential, verify read-only posture, and
  //    introspect the granted surface. This is the only step that touches the
  //    external host, and it fails before any write.
  let model;
  try {
    model = await probeAndModelExternalSource(input);
  } catch (err) {
    if (err instanceof AnalystRegistrationPostureError) {
      throw new GraphQLError(err.message, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    throw new GraphQLError(
      `registerAnalystDataSource: could not connect to the source: ${err instanceof Error ? err.message : String(err)}`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  // 4. Per-source reader credential secret.
  const secretName = analystSourceCredentialSecretName({
    tenantId,
    slug: input.slug,
  });
  const credentialSecretArn = await writeSourceCredentialSecret({
    secretName,
    password: input.password,
    dbUser: input.dbUser,
    host: input.host,
  });

  // 5. model.json + rendered SCHEMA.md to S3.
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

  // 6. Born-approved registry row (schema/kind/generation ride in
  //    runtime_metadata.analyst_source — THINK-283).
  const { id: serverId } = await insertExternalSourceRow({
    tenantId,
    input,
    apiBase: apiBase!,
    brokerSecretRef: brokerSecretRef!,
    credentialSecretArn,
    source: { kind: "external" },
  });

  // 7. Union the slug into the analyst profile's tool policy.
  await appendSourceToAnalystProfile({ tenantId, slug: input.slug });

  // 8. Materialize the signed connections/<slug>/ folder into every agent.
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
