/**
 * Analyst reader DB module (THINK-228 U3).
 *
 * Lazy `pg.Client` keyed off `ANALYST_READER_SECRET_ARN` — the dedicated
 * `analyst_reader` Aurora role provisioned by
 * drizzle/0227_analyst_reader_role.sql. Mirrors
 * packages/api/src/lib/compliance/reader-db.ts (dedicated lazy client,
 * never `SET LOCAL ROLE` on a shared pool: a query that forgets the
 * wrapper would inherit writer privileges silently).
 *
 * The broker deliberately never uses the platform writer credential
 * (`DATABASE_SECRET_ARN` is in the shared handler env but is unused
 * here) — model-authored SQL executes only as `analyst_reader`.
 *
 * Test escape hatch: `ANALYST_READER_DATABASE_URL` bypasses the Secrets
 * Manager fetch so the broker's integration tests can point at a local
 * or dev Postgres directly.
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { Client as PgClientType } from "pg";

let _client: PgClientType | undefined;
let _secretsManager: SecretsManagerClient | undefined;

interface SecretShape {
  username: string;
  password: string;
  host: string;
  port: number | string;
  dbname: string;
}

function getSecretsManagerClient(): SecretsManagerClient {
  if (_secretsManager) return _secretsManager;
  _secretsManager = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
    requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
  });
  return _secretsManager;
}

async function resolveDatabaseUrl(): Promise<string> {
  const secretArn = process.env.ANALYST_READER_SECRET_ARN;
  if (!secretArn) {
    throw new Error(
      "analyst-reader-db: ANALYST_READER_SECRET_ARN is unset. " +
        "Provision via STAGE=<stage> bash scripts/bootstrap-analyst-roles.sh " +
        "and wire the ARN on the analyst-query-broker Lambda via Terraform.",
    );
  }
  const sm = getSecretsManagerClient();
  const result = await sm.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  const secret = JSON.parse(result.SecretString || "{}") as SecretShape;
  const user = encodeURIComponent(secret.username);
  const pass = encodeURIComponent(secret.password);
  return `postgresql://${user}:${pass}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=require`;
}

/**
 * Lazy client cache. Reused across warm invocations; the broker issues
 * `DISCARD ALL` before every query (KTD7) so session state (GUCs, named
 * prepared statements) never leaks between invocations.
 */
export async function getAnalystReaderClient(): Promise<PgClientType> {
  if (_client) return _client;

  const url =
    process.env.ANALYST_READER_DATABASE_URL || (await resolveDatabaseUrl());
  const { Client } = await import("pg");
  const client = new Client({ connectionString: url });
  await client.connect();
  client.on("error", () => {
    _client = undefined;
  });
  _client = client;
  return client;
}

/** Test-only: close + clear the cached client. */
export async function _resetAnalystReaderClient(): Promise<void> {
  const existing = _client;
  _client = undefined;
  _secretsManager = undefined;
  if (existing) {
    try {
      await existing.end();
    } catch {
      // best-effort close
    }
  }
}
