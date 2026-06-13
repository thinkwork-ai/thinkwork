/**
 * Tenants-table leg for the ops CLI.
 *
 * The claim tool's DB authority is the SaaS PRODUCTION tenants table by
 * default (KTD1 — most tenant slugs exist only in the DB). Resolution
 * reuses the db:push wiring's Secrets Manager credential shape, keyed by
 * the stage-named resources Terraform creates:
 *
 *   cluster   thinkwork-<stage>-db              (aurora-postgres module)
 *   secret    thinkwork-<stage>-db-credentials  (username/password JSON)
 *
 * A DATABASE_URL env var short-circuits resolution (same escape hatch as
 * scripts/db-push.sh) but is loudly flagged, since it bypasses the
 * production-authority default.
 */

import { execSync } from "node:child_process";
import pg from "pg";
import type { TenantSlugSource } from "./core.js";

export const DEFAULT_TENANT_DB_STAGE = "prod";

const STAGE_PATTERN = /^[a-z0-9][a-z0-9-]*$/;

export interface TenantSourceHandle {
  source: TenantSlugSource;
  close(): Promise<void>;
}

function aws(command: string): string {
  return execSync(command, {
    encoding: "utf-8",
    stdio: ["pipe", "pipe", "pipe"],
  }).trim();
}

export function resolveStageDatabaseUrl(
  stage: string,
  env: Record<string, string | undefined>,
  warn: (message: string) => void,
): string {
  if (env.DATABASE_URL) {
    warn(
      "!!! WARNING: DATABASE_URL is set — using it directly and BYPASSING " +
        `stage resolution (stage "${stage}"). Make sure this points at the ` +
        "SaaS production tenant authority before claiming.",
    );
    return env.DATABASE_URL;
  }
  if (!STAGE_PATTERN.test(stage)) {
    throw new Error(`invalid stage name: "${stage}"`);
  }

  let endpoint: string;
  try {
    endpoint = aws(
      `aws rds describe-db-clusters --db-cluster-identifier "thinkwork-${stage}-db" ` +
        `--query "DBClusters[0].Endpoint" --output text`,
    );
  } catch (err) {
    throw new Error(
      `could not resolve the Aurora endpoint for stage "${stage}" ` +
        `(aws rds describe-db-clusters thinkwork-${stage}-db failed). ` +
        `Check AWS credentials/region, or set DATABASE_URL directly.\n` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  let secretJson: string;
  try {
    secretJson = aws(
      `aws secretsmanager get-secret-value --secret-id "thinkwork-${stage}-db-credentials" ` +
        `--query SecretString --output text`,
    );
  } catch (err) {
    throw new Error(
      `could not resolve DB credentials for stage "${stage}" ` +
        `(secret thinkwork-${stage}-db-credentials). ` +
        (err instanceof Error ? err.message : String(err)),
    );
  }

  const parsed = JSON.parse(secretJson) as {
    username?: string;
    password?: string;
  };
  if (!parsed.username || !parsed.password) {
    throw new Error(
      `secret thinkwork-${stage}-db-credentials is missing username/password`,
    );
  }

  const user = encodeURIComponent(parsed.username);
  const pass = encodeURIComponent(parsed.password);
  // No sslmode in the URL: on pg >= 8.20 a connection-string sslmode is
  // treated as verify-full and OVERRIDES the client's explicit `ssl` option,
  // so `ssl: { rejectUnauthorized: false }` stopped applying and every
  // stage-resolved connection died on Aurora's untrusted CA chain ("unable
  // to get local issuer certificate"). TLS posture is governed solely by the
  // pg.Client `ssl` option in createStageTenantSource.
  return `postgresql://${user}:${pass}@${endpoint}:5432/thinkwork`;
}

export async function createStageTenantSource(
  stage: string,
  env: Record<string, string | undefined>,
  warn: (message: string) => void,
): Promise<TenantSourceHandle> {
  const connectionString = resolveStageDatabaseUrl(stage, env, warn);
  const client = new pg.Client({
    connectionString,
    // Aurora's cert chain isn't in the default trust store; this matches
    // the posture of the existing db:push tooling (TLS on, no CA pinning).
    ssl: { rejectUnauthorized: false },
  });
  await client.connect();
  return {
    source: {
      async slugExists(slug: string): Promise<boolean> {
        const result = await client.query(
          "SELECT 1 FROM tenants WHERE slug = $1 LIMIT 1",
          [slug],
        );
        return (result.rowCount ?? 0) > 0;
      },
    },
    async close(): Promise<void> {
      await client.end();
    },
  };
}
