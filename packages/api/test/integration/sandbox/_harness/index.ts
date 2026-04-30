/**
 * AgentCore Code Sandbox end-to-end harness.
 *
 * Shared factory + helpers every sandbox-*.e2e.test.ts file composes.
 * The harness talks to **live infra** (not mocked AWS) — its job is to
 * catch deploy-level seam failures that unit tests can't see. See
 * `../README.md` for the required env vars, invocation commands, and
 * failure-mode triage.
 */

import { randomBytes } from "node:crypto";

export interface HarnessEnv {
  thinkworkApiUrl: string;
  apiAuthSecret: string;
  databaseUrl: string;
  awsRegion: string;
  stage: string;
  agentcoreRuntimeLogGroup: string;
  operatorEmail: string;
}

export class HarnessEnvError extends Error {
  missing: string[];
  constructor(missing: string[]) {
    super(
      `sandbox-e2e harness missing required env vars: ${missing.join(", ")}. See packages/api/test/integration/sandbox/README.md.`,
    );
    this.name = "HarnessEnvError";
    this.missing = missing;
    Object.setPrototypeOf(this, HarnessEnvError.prototype);
  }
}

/**
 * Read + validate every required env var. Fails loud with the exact
 * missing names — avoids the vitest-default "undefined is not a
 * string" surprise that makes aborted harnesses hard to diagnose.
 */
export function readHarnessEnv(
  env: NodeJS.ProcessEnv = process.env,
): HarnessEnv {
  const required = {
    thinkworkApiUrl: env.THINKWORK_API_URL,
    apiAuthSecret: env.API_AUTH_SECRET,
    databaseUrl: normalizeNodePgDatabaseUrl(env.DATABASE_URL),
    awsRegion: env.AWS_REGION,
    stage: env.STAGE,
    agentcoreRuntimeLogGroup: env.AGENTCORE_RUNTIME_LOG_GROUP,
    operatorEmail: env.THINKWORK_E2E_OPERATOR_EMAIL,
  };
  const missing = Object.entries(required)
    .filter(([, v]) => !v)
    .map(([k]) => envVarName(k));
  if (missing.length > 0) throw new HarnessEnvError(missing);
  return required as HarnessEnv;
}

function normalizeNodePgDatabaseUrl(
  url: string | undefined,
): string | undefined {
  return url?.replace("sslmode=require", "sslmode=no-verify");
}

function envVarName(camelKey: string): string {
  const map: Record<string, string> = {
    thinkworkApiUrl: "THINKWORK_API_URL",
    apiAuthSecret: "API_AUTH_SECRET",
    databaseUrl: "DATABASE_URL",
    awsRegion: "AWS_REGION",
    stage: "STAGE",
    agentcoreRuntimeLogGroup: "AGENTCORE_RUNTIME_LOG_GROUP",
    operatorEmail: "THINKWORK_E2E_OPERATOR_EMAIL",
  };
  return map[camelKey] ?? camelKey;
}

/**
 * 8-char hex run id, embedded in every fixture name so aborted runs
 * can be cleanly swept via `--cleanup-only`.
 */
export function newRunId(): string {
  return randomBytes(4).toString("hex");
}

/**
 * The FIXTURE_NAME_PREFIX is what cleanup greps for. Embedded in every
 * tenant + template + agent slug so a single SQL LIKE pattern sweeps all.
 */
export const FIXTURE_NAME_PREFIX = "sandbox-e2e-";

export interface FixtureName {
  runId: string;
  tenantName: string;
  tenantSlug: string;
  templateName: string;
  templateSlug: string;
  agentName: string;
  agentSlug: string;
}

export function nameFixtures(runId: string, suffix = ""): FixtureName {
  const base = `${FIXTURE_NAME_PREFIX}${runId}${suffix ? `-${suffix}` : ""}`;
  return {
    runId,
    tenantName: `${base} tenant`,
    tenantSlug: base,
    templateName: `${base} template`,
    templateSlug: `${base}-template`,
    agentName: `${base} agent`,
    agentSlug: `${base}-agent`,
  };
}
