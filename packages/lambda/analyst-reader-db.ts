/**
 * Analyst reader DB module (THINK-228 U3, hardened by THINK-229 U1).
 *
 * Lazy `pg.Client` for the dedicated `analyst_reader` Aurora role
 * provisioned by drizzle/0227_analyst_reader_role.sql. Mirrors
 * packages/api/src/lib/compliance/reader-db.ts (dedicated lazy client,
 * never `SET LOCAL ROLE` on a shared pool: a query that forgets the
 * wrapper would inherit writer privileges silently).
 *
 * Connect strategy (THINK-229 U1 — trust-anchored credential chain):
 *
 *   1. `ANALYST_READER_DATABASE_URL` — test escape hatch; connects
 *      verbatim so integration tests can point at a local Postgres.
 *   2. RDS IAM auth — when `ANALYST_DB_CLUSTER_ENDPOINT` is set, mint a
 *      15-minute auth token via `@aws-sdk/rds-signer` per (re)connect and
 *      present it as the password over TLS verified against the bundled
 *      RDS CA (`rejectUnauthorized: true` — no more sslmode=no-verify).
 *      Tokens are connect-only: the cached client outlives the token by
 *      design (AWS-documented), and a fresh token is minted on every
 *      reconnect. One fresh-token retry absorbs documented under-load PAM
 *      transients.
 *   3. Password fallback — pre-`GRANT rds_iam` window only. Once the
 *      grant lands, Postgres refuses password login for the role and the
 *      IAM path carries (KTD2 dual-path: no coordinated flip). Retirement
 *      of `ANALYST_READER_SECRET_ARN` is the dated follow-up once IAM is
 *      proven live.
 *
 * The broker deliberately never uses the platform writer credential
 * (`DATABASE_SECRET_ARN` is in the shared handler env but is unused
 * here) — model-authored SQL executes only as `analyst_reader`.
 */

import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { Client as PgClientType } from "pg";

import { RDS_CA_BUNDLE } from "./rds-ca-bundle.js";

let _client: PgClientType | undefined;
let _secretsManager: SecretsManagerClient | undefined;

interface SecretShape {
  username: string;
  password: string;
  host: string;
  port: number | string;
  dbname: string;
}

export interface AnalystIamConnectConfig {
  host: string;
  port: number;
  database: string;
  user: string;
  region: string;
}

/** IAM connect config from the broker Lambda env (Terraform-supplied). */
export function resolveIamConnectConfig(
  env: NodeJS.ProcessEnv = process.env,
): AnalystIamConnectConfig | null {
  const host = env.ANALYST_DB_CLUSTER_ENDPOINT;
  if (!host) return null;
  const port = Number.parseInt(env.ANALYST_DB_PORT || "5432", 10);
  return {
    host,
    port: Number.isFinite(port) && port > 0 ? port : 5432,
    database: env.ANALYST_DB_NAME || "thinkwork",
    // Exact case matters: the IAM policy resource and the Postgres role
    // are both case-sensitive ("analyst_reader").
    user: env.ANALYST_DB_USER || "analyst_reader",
    region: env.AWS_REGION || "us-east-1",
  };
}

function logConnect(fields: Record<string, unknown>): void {
  // Structured connect audit (R6/KTD4): CloudTrail does NOT log IAM DB
  // auth, so this line + cluster log_connections are the credential-use
  // trail. Never log token material.
  console.log(JSON.stringify({ msg: "analyst-reader-db.connect", ...fields }));
}

function getSecretsManagerClient(): SecretsManagerClient {
  if (_secretsManager) return _secretsManager;
  _secretsManager = new SecretsManagerClient({
    region: process.env.AWS_REGION || "us-east-1",
    requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
  });
  return _secretsManager;
}

async function mintIamAuthToken(
  config: AnalystIamConnectConfig,
): Promise<string> {
  const { Signer } = await import("@aws-sdk/rds-signer");
  const signer = new Signer({
    hostname: config.host,
    port: config.port,
    username: config.user,
    region: config.region,
  });
  return signer.getAuthToken();
}

const CONNECT_TIMEOUT_MS = 5000;

async function connectWithIam(
  config: AnalystIamConnectConfig,
): Promise<PgClientType> {
  const { Client } = await import("pg");
  const token = await mintIamAuthToken(config);
  const client = new Client({
    host: config.host,
    port: config.port,
    database: config.database,
    user: config.user,
    password: token,
    // R3: full TLS verification against the bundled RDS CA. IAM auth
    // requires SSL server-side; no-verify is the retired shortcut.
    ssl: { ca: RDS_CA_BUNDLE, rejectUnauthorized: true },
    // A hung connect must fail fast into the retry/fallback chain rather
    // than eating the whole broker invocation.
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await client.connect();
  return client;
}

/**
 * Auth-shaped connect failures (the server authenticated the transport
 * and rejected the credential) are the ONLY errors that may trigger the
 * password fallback. Transport/TLS failures rethrow instead — falling
 * back there would let an on-path attacker force the credential
 * downgrade by breaking the IAM connection.
 */
function isAuthShapedError(err: unknown): boolean {
  if (!err || typeof err !== "object") return false;
  const code = (err as { code?: string }).code;
  // 28000 invalid_authorization_specification, 28P01 invalid_password —
  // both cover RDS's "PAM authentication failed" IAM rejections.
  if (code === "28000" || code === "28P01") return true;
  const message = err instanceof Error ? err.message : "";
  return /password authentication failed|PAM authentication failed|pg_hba\.conf/i.test(
    message,
  );
}

async function resolvePasswordSecret(): Promise<SecretShape> {
  const secretArn = process.env.ANALYST_READER_SECRET_ARN;
  if (!secretArn) {
    throw new Error(
      "analyst-reader-db: neither ANALYST_DB_CLUSTER_ENDPOINT (IAM path) nor " +
        "ANALYST_READER_SECRET_ARN (password fallback) is set. Provision via " +
        "STAGE=<stage> bash scripts/bootstrap-analyst-roles.sh and wire the " +
        "broker env via Terraform.",
    );
  }
  const sm = getSecretsManagerClient();
  const result = await sm.send(
    new GetSecretValueCommand({ SecretId: secretArn }),
  );
  return JSON.parse(result.SecretString || "{}") as SecretShape;
}

async function connectWithPassword(): Promise<PgClientType> {
  const { Client } = await import("pg");
  if (process.env.ANALYST_READER_DATABASE_URL) {
    // Test escape hatch — connect verbatim (local Postgres, no TLS).
    const client = new Client({
      connectionString: process.env.ANALYST_READER_DATABASE_URL,
      connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
    });
    await client.connect();
    return client;
  }
  const secret = await resolvePasswordSecret();
  const client = new Client({
    host: secret.host,
    port: Number(secret.port),
    database: secret.dbname,
    user: secret.username,
    password: secret.password,
    // Same verified-TLS posture as the IAM path — the bundled CA removed
    // the original justification for sslmode=no-verify (THINK-228's
    // Lambda-runtime-doesn't-trust-the-RDS-CA workaround).
    ssl: { ca: RDS_CA_BUNDLE, rejectUnauthorized: true },
    connectionTimeoutMillis: CONNECT_TIMEOUT_MS,
  });
  await client.connect();
  return client;
}

async function establishConnection(): Promise<PgClientType> {
  if (process.env.ANALYST_READER_DATABASE_URL) {
    const client = await connectWithPassword();
    logConnect({ strategy: "url", outcome: "ok" });
    return client;
  }

  const iamConfig = resolveIamConnectConfig();
  if (iamConfig) {
    // Two IAM attempts (fresh token each — KTD2's one-retry for PAM
    // transients), then the password fallback if a secret is wired AND
    // the failure was auth-shaped (see isAuthShapedError — transport
    // failures rethrow so a broken network can't force the downgrade).
    let lastErr: unknown;
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        const client = await connectWithIam(iamConfig);
        logConnect({
          strategy: "iam",
          outcome: "ok",
          attempt,
          host: iamConfig.host,
          user: iamConfig.user,
        });
        return client;
      } catch (err) {
        lastErr = err;
        logConnect({
          strategy: "iam",
          outcome: "error",
          attempt,
          host: iamConfig.host,
          user: iamConfig.user,
          error: err instanceof Error ? err.message : String(err),
        });
      }
    }
    if (process.env.ANALYST_READER_SECRET_ARN && isAuthShapedError(lastErr)) {
      const client = await connectWithPassword();
      logConnect({ strategy: "password", outcome: "ok", fallback: true });
      return client;
    }
    throw lastErr;
  }

  const client = await connectWithPassword();
  logConnect({ strategy: "password", outcome: "ok", fallback: false });
  return client;
}

/**
 * Lazy client cache. Reused across warm invocations; the broker issues
 * `DISCARD ALL` before every query (KTD7) so session state (GUCs, named
 * prepared statements) never leaks between invocations.
 */
export async function getAnalystReaderClient(): Promise<PgClientType> {
  if (_client) return _client;
  const client = await establishConnection();
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
