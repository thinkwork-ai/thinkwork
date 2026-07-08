#!/usr/bin/env tsx
/**
 * Provision the ThinkWork Analyst dev Postgres connector (THINK-228 U4/U5).
 *
 * Steps (idempotent — safe to re-run):
 *   1. Ensure the broker credential secret has a value: JSON
 *      {token, tenantId}. Generates a token on first run; preserves the
 *      existing one after that (pass --rotate-token to mint a new one,
 *      which requires --re-approve since callers resolve the same secret).
 *   2. Seed the approved `tenant_mcp_servers` row (slug postgres-dev)
 *      pointing at POST /mcp/analyst with secretRef-only auth_config and
 *      a pinned url_hash (KTD4). `--re-approve` rewrites url/auth_config
 *      and restamps approval after a rotation — the scripted answer to
 *      SI-5 with no approval UI.
 *   3. Materialize the workspace connection folder
 *      (connections/postgres-dev/CONNECTION.md + SCHEMA.md) so the
 *      analyst reads the semantic model as ordinary workspace files (U5).
 *
 * Required env:
 *   DATABASE_URL               — target stage's Postgres (writer; row seed only)
 *   TENANT_ID                  — tenant to register the connector under
 *   ANALYST_BROKER_SECRET_ARN  — broker credential secret container (terraform)
 *   ANALYST_BROKER_URL         — broker endpoint (or THINKWORK_API_URL to derive)
 * Optional:
 *   AWS_REGION (default us-east-1)
 *
 * Usage:
 *   npx tsx scripts/provision-analyst-connector.ts [--re-approve] [--rotate-token]
 */

import { randomBytes } from "node:crypto";
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

import {
  GetSecretValueCommand,
  PutSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";

import { materializeAnalystConnectionFolder } from "../packages/api/src/lib/analyst/connection-folder";
import {
  provisionAnalystConnector,
  resolveAnalystProvisionConfig,
} from "../packages/api/src/lib/analyst/provision-connector";

const HERE = dirname(fileURLToPath(import.meta.url));
const SCHEMA_MD_PATH = join(
  HERE,
  "..",
  "packages",
  "database-pg",
  "generated",
  "analyst",
  "SCHEMA.md",
);

async function ensureBrokerSecretValue(
  secretRef: string,
  tenantId: string,
  rotate: boolean,
): Promise<void> {
  const sm = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
  });
  let existing: { token?: string; tenantId?: string } = {};
  try {
    const current = await sm.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    existing = JSON.parse(current.SecretString || "{}") as typeof existing;
  } catch {
    // No value yet (fresh container) — we'll write one below.
  }
  if (!rotate && existing.token && existing.tenantId === tenantId) {
    console.error("==> Broker credential secret already populated");
    return;
  }
  const token =
    rotate || !existing.token
      ? randomBytes(32).toString("hex")
      : existing.token;
  await sm.send(
    new PutSecretValueCommand({
      SecretId: secretRef,
      SecretString: JSON.stringify({ token, tenantId }),
    }),
  );
  console.error(
    rotate || !existing.token
      ? "==> Broker credential secret populated (new token minted)"
      : "==> Broker credential secret updated (tenantId aligned)",
  );
}

async function main() {
  const args = new Set(process.argv.slice(2));
  const reApprove = args.has("--re-approve");
  const rotateToken = args.has("--rotate-token");

  if (rotateToken && !reApprove) {
    // Not strictly required (the row's auth_config only references the
    // secret ARN, which doesn't change on rotation), but insist so the
    // operator consciously re-stamps in one motion.
    console.error(
      "--rotate-token invalidates every cached caller token; pass --re-approve with it.",
    );
    process.exit(2);
  }
  if (!process.env.DATABASE_URL) {
    console.error("DATABASE_URL is required (target stage Postgres).");
    process.exit(2);
  }

  const config = resolveAnalystProvisionConfig(process.env);

  await ensureBrokerSecretValue(config.secretRef, config.tenantId, rotateToken);

  const outcome = await provisionAnalystConnector({ ...config, reApprove });
  console.error(
    `==> Connector row ${outcome.action} (id ${outcome.id}, url ${config.brokerUrl})`,
  );

  // U5: materialize the workspace connection folder (CONNECTION.md +
  // signed .assignment.json + the generated SCHEMA.md semantic model).
  const schemaMarkdown = readFileSync(SCHEMA_MD_PATH, "utf-8");
  const folder = await materializeAnalystConnectionFolder({
    tenantId: config.tenantId,
    tenantMcpServerId: outcome.id,
    schemaMarkdown,
  });
  console.error(
    `==> Workspace connection folder written for ${folder.agents} agent(s): ${folder.files.join(", ")}`,
  );

  process.exit(0);
}

main().catch((err) => {
  console.error(err instanceof Error ? err.message : err);
  process.exit(1);
});
