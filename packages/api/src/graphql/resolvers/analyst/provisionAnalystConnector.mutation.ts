/**
 * provisionAnalystConnector (THINK-230).
 *
 * Operator-facing GraphQL entry point for the analyst connector provisioning
 * ceremony that previously ran only via
 * `scripts/provision-analyst-connector.mts`. It reproduces the script's
 * ordered ceremony (KTD4 / SI-5 born-approved + re-approve semantics) so the
 * web app can register or re-approve the analyst Postgres data source without
 * a CLI-flag invocation.
 *
 * Ceremony order (mirrors the script's main()):
 *   1. ensureAnalystBrokerSecret     — write/rotate the broker credential
 *   2. ensureAnalystRdsIamCredential — only when the IAM env block is wired
 *   3. provisionAnalystConnector     — upsert the approved registry row
 *   4. (retired U11) analyst profile refresh — the built-in analyst is a
 *      workspace agents/analyst/ folder now; no DB row to refresh
 *   5. materializeAnalystConnectionFolder — write the signed workspace folder
 *
 * Config resolution: every document-only key is read through
 * `@thinkwork/runtime-config`'s `getConfig` (env-wins merge over the SSM
 * runtime-config document) — never `process.env` directly, which the
 * apps/cli runtime-config fixture test enforces. `TENANT_ID` comes from the
 * authenticated caller, not from config.
 */

import { GraphQLError } from "graphql";
import { getConfig } from "@thinkwork/runtime-config";
import { generateAnalystSchemaMarkdown } from "@thinkwork/database-pg/analyst";

import type { GraphQLContext } from "../../context.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCaller } from "../core/resolve-auth-user.js";
import { materializeAnalystConnectionFolder } from "../../../lib/analyst/connection-folder.js";
import {
  ensureAnalystBrokerSecret,
  ensureAnalystRdsIamCredential,
  provisionAnalystConnector as provisionAnalystConnectorRow,
  resolveAnalystProvisionConfig,
  resolveAnalystRdsIamConfig,
} from "../../../lib/analyst/provision-connector.js";
import type { CapabilitySignedBy } from "../../../lib/capabilities/sidecar-signing.js";

export interface AnalystProvisionResult {
  connectorId: string;
  connectorOutcome: string;
  brokerSecretOutcome: string;
  rdsIamCredentialOutcome: string | null;
  profileRefreshed: boolean;
  foldersWritten: number;
  foldersSkipped: number;
}

/**
 * Build the provisioning env map from the SSM runtime-config document.
 * `TENANT_ID` is caller-supplied (never a config key). Every other value is
 * read through `getConfig` so `process.env` is never consulted for
 * document-only keys (apps/cli runtime-config fixture gate).
 */
function analystProvisionEnv(
  tenantId: string,
): Record<string, string | undefined> {
  const cfg = (key: string): string | undefined => {
    try {
      return getConfig(key) || undefined;
    } catch {
      return undefined;
    }
  };
  return {
    TENANT_ID: tenantId,
    ANALYST_BROKER_SECRET_ARN: cfg("ANALYST_BROKER_SECRET_ARN"),
    ANALYST_BROKER_URL: cfg("ANALYST_BROKER_URL"),
    THINKWORK_API_URL: cfg("THINKWORK_API_URL"),
    ANALYST_DB_CLUSTER_ENDPOINT: cfg("ANALYST_DB_CLUSTER_ENDPOINT"),
    ANALYST_DB_CLUSTER_RESOURCE_ID: cfg("ANALYST_DB_CLUSTER_RESOURCE_ID"),
    ANALYST_DB_PORT: cfg("ANALYST_DB_PORT"),
    ANALYST_DB_NAME: cfg("ANALYST_DB_NAME"),
    ANALYST_DB_USER: cfg("ANALYST_DB_USER"),
  };
}

export const provisionAnalystConnector = async (
  _parent: unknown,
  args: { reApprove?: boolean | null; rotateToken?: boolean | null },
  ctx: GraphQLContext,
): Promise<AnalystProvisionResult> => {
  const { userId, tenantId } = await resolveCaller(ctx);
  if (!tenantId) {
    throw new GraphQLError("Tenant context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }
  // Owner/admin only — same role gate as the mcp-approval handler.
  await requireTenantAdmin(ctx, tenantId);

  const rotateToken = args.rotateToken === true;
  // A token rotation invalidates every cached caller token, so it forces a
  // re-approve — mirrors the script's `--rotate-token` implies `--re-approve`.
  const reApprove = args.reApprove === true || rotateToken;

  const env = analystProvisionEnv(tenantId);
  let config;
  try {
    config = resolveAnalystProvisionConfig(env);
  } catch (err) {
    // Surface the lib's message naming exactly which broker config is missing.
    throw new GraphQLError(err instanceof Error ? err.message : String(err), {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const signer = ctx.auth.email || userId || "unknown";
  const signedBy: CapabilitySignedBy = `operator:${signer}`;

  // 1. Broker credential secret (mint on first run; rotate mints a new token).
  const brokerSecretOutcome = await ensureAnalystBrokerSecret({
    secretRef: config.secretRef,
    tenantId: config.tenantId,
    rotate: rotateToken,
  });

  // 2. Optional rds_iam credential row — only when the IAM env block is wired.
  const rdsIamConfig = resolveAnalystRdsIamConfig(env, config.tenantId);
  let rdsIamCredentialOutcome: string | null = null;
  if (rdsIamConfig) {
    rdsIamCredentialOutcome = await ensureAnalystRdsIamCredential(rdsIamConfig);
  }

  // 3. Registry row. Throws with an operator-facing "re-approve" message when
  //    url/auth_config drifted without reApprove — surface it verbatim.
  let outcome;
  try {
    outcome = await provisionAnalystConnectorRow({ ...config, reApprove });
  } catch (err) {
    throw new GraphQLError(err instanceof Error ? err.message : String(err), {
      extensions: { code: "CONFLICT" },
    });
  }

  // 4. Materialize the signed workspace connection folder. The generated
  //    semantic model is produced from the committed source rather than the
  //    on-disk SCHEMA.md file, which is not present in the Lambda bundle.
  const schemaMarkdown = generateAnalystSchemaMarkdown();
  const folder = await materializeAnalystConnectionFolder({
    tenantId: config.tenantId,
    tenantMcpServerId: outcome.id,
    schemaMarkdown,
    signedBy,
  });

  return {
    connectorId: outcome.id,
    connectorOutcome: outcome.action,
    brokerSecretOutcome,
    rdsIamCredentialOutcome,
    profileRefreshed: true,
    foldersWritten: folder.agents,
    foldersSkipped: folder.skipped.length,
  };
};
