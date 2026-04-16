/**
 * Persistent CLI settings stored at `~/.thinkwork/config.json`.
 *
 * Today this only holds the user's chosen AWS profile so commands after
 * `thinkwork login` don't fall back to the shell's default credentials.
 * The `preAction` hook in cli.ts reads `defaultProfile` when `--profile`
 * and `$AWS_PROFILE` aren't set, and `login` writes it after a successful
 * picker / key-entry / SSO flow.
 */

import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { homedir } from "node:os";
import { dirname, join } from "node:path";

export interface CliConfig {
  /** AWS profile to apply when `--profile` / `$AWS_PROFILE` are unset. */
  defaultProfile?: string;
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
