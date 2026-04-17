/**
 * Persistent CLI settings stored at `~/.thinkwork/config.json`.
 *
 * Two kinds of state live here:
 *
 *   1. AWS profile preferences — `defaultProfile` tells the preAction hook in
 *      cli.ts which ~/.aws profile to use when `--profile` and `$AWS_PROFILE`
 *      are unset. Set by `thinkwork login` (no-stage form).
 *
 *   2. Stack sessions — one per stage. Either a Cognito session (idToken +
 *      refreshToken + expiry) obtained by `thinkwork login --stage <s>`, or
 *      a static API-key session for CI/service callers. Commands resolve
 *      auth via `resolveAuth(stage)` which refreshes expired Cognito tokens
 *      transparently.
 *
 * Rewriting the file is always a merge (shallow), so concurrent writes to
 * different keys don't clobber each other.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CognitoSession {
  kind: "cognito";
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the id/access token expires. */
  expiresAt: number;
  userPoolId: string;
  userPoolClientId: string;
  /** Short domain ("thinkwork-dev"); callers format the full hosted-UI URL. */
  cognitoDomain: string;
  region: string;
  /** Cognito `sub` claim — used to rewrite `assigneeId = principalId` filters. */
  principalId: string;
  /** User's email from the id_token. Cosmetic. */
  email?: string;
  /** Cached tenant context so commands don't have to re-fetch on every call. */
  tenantId?: string;
  tenantSlug?: string;
}

export interface ApiKeySession {
  kind: "api-key";
  /** Raw bearer secret. Matches today's `api_auth_secret` in terraform.tfvars. */
  authSecret: string;
  /** Required for server-side tenant scoping on the api-key auth path. */
  tenantId?: string;
  tenantSlug?: string;
}

export type StageSession = CognitoSession | ApiKeySession;

export interface CliConfig {
  /** AWS profile to apply when `--profile` / `$AWS_PROFILE` are unset. */
  defaultProfile?: string;
  /** Stage used when commands omit `-s/--stage`. */
  defaultStage?: string;
  /** Per-stage auth sessions, keyed by stage name. */
  sessions?: Record<string, StageSession>;
}

/**
 * Resolve the config path. Takes an optional override so tests can redirect
 * to a tmpdir without having to patch `os.homedir()`.
 */
export function getCliConfigPath(override?: string): string {
  return override ?? join(homedir(), ".thinkwork", "config.json");
}

export function loadCliConfig(pathOverride?: string): CliConfig {
  const path = getCliConfigPath(pathOverride);
  if (!existsSync(path)) return {};
  try {
    return JSON.parse(readFileSync(path, "utf-8")) as CliConfig;
  } catch {
    return {};
  }
}

export function saveCliConfig(next: CliConfig, pathOverride?: string): void {
  const path = getCliConfigPath(pathOverride);
  const dir = dirname(path);
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true });
  const merged = { ...loadCliConfig(pathOverride), ...next };
  writeFileSync(path, JSON.stringify(merged, null, 2) + "\n");
}

/**
 * Deep-merge a single stage's session into the config without clobbering the
 * other stages. Use this from `thinkwork login --stage <s>` to store tokens.
 */
export function saveStageSession(
  stage: string,
  session: StageSession,
  pathOverride?: string,
): void {
  const current = loadCliConfig(pathOverride);
  const sessions = { ...(current.sessions ?? {}), [stage]: session };
  saveCliConfig({ sessions }, pathOverride);
}

/**
 * Read a single stage's session. Returns null when the stage has never been
 * logged into — callers should prompt the user to run `thinkwork login`.
 */
export function loadStageSession(
  stage: string,
  pathOverride?: string,
): StageSession | null {
  return loadCliConfig(pathOverride).sessions?.[stage] ?? null;
}

/** Forget a single stage's session (for `thinkwork logout --stage <s>`). */
export function clearStageSession(stage: string, pathOverride?: string): void {
  const current = loadCliConfig(pathOverride);
  if (!current.sessions?.[stage]) return;
  const { [stage]: _removed, ...rest } = current.sessions;
  saveCliConfig({ sessions: rest }, pathOverride);
}
