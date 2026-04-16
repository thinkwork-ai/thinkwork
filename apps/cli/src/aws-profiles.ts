/**
 * AWS profile discovery — parses `~/.aws/credentials` and `~/.aws/config`
 * so `thinkwork login` can offer a picker instead of prompting for raw keys.
 *
 * Scope is deliberately narrow: we only need profile names and a hint at
 * their type (static keys vs SSO vs role) for the UI. Credential resolution
 * still goes through the AWS CLI — we never read secrets from these files.
 */

import { existsSync, readFileSync } from "node:fs";
import { homedir } from "node:os";
import { join } from "node:path";

export interface AwsProfile {
  name: string;
  /** `credentials` if the profile has static keys, `config` if it's SSO / role only. */
  source: "credentials" | "config" | "both";
  type: "keys" | "sso" | "role" | "other";
}

const CREDENTIALS_PATH = join(homedir(), ".aws", "credentials");
const CONFIG_PATH = join(homedir(), ".aws", "config");

/**
 * Parse an INI-style AWS rc file into a map of { sectionName → { key → value } }.
 *
 * `~/.aws/config` uses `[profile <name>]` for non-default entries (the literal
 * `[default]` stays as-is); `~/.aws/credentials` uses plain `[<name>]`. This
 * function returns the raw section name — callers normalize.
 */
function parseIni(content: string): Record<string, Record<string, string>> {
  const sections: Record<string, Record<string, string>> = {};
  let current: string | null = null;
  for (const rawLine of content.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (!line || line.startsWith("#") || line.startsWith(";")) continue;
    const header = line.match(/^\[(.+)\]$/);
    if (header) {
      current = header[1].trim();
      sections[current] ??= {};
      continue;
    }
    if (!current) continue;
    const eq = line.indexOf("=");
    if (eq === -1) continue;
    const key = line.slice(0, eq).trim();
    const value = line.slice(eq + 1).trim();
    sections[current][key] = value;
  }
  return sections;
}

function normalizeConfigSection(section: string): string | null {
  if (section === "default") return "default";
  if (section.startsWith("profile ")) return section.slice("profile ".length).trim();
  // `[sso-session ...]` and other non-profile sections are skipped.
  return null;
}

function classify(fields: Record<string, string>): AwsProfile["type"] {
  if (fields.aws_access_key_id) return "keys";
  if (
    fields.sso_start_url ||
    fields.sso_session ||
    fields.sso_account_id ||
    fields.sso_role_name
  ) {
    return "sso";
  }
  if (fields.role_arn || fields.source_profile || fields.credential_source) {
    return "role";
  }
  return "other";
}

/** Read both AWS rc files and return the merged profile list, sorted by name. */
export function listAwsProfiles(): AwsProfile[] {
  const byName = new Map<string, AwsProfile>();

  if (existsSync(CREDENTIALS_PATH)) {
    const sections = parseIni(readFileSync(CREDENTIALS_PATH, "utf-8"));
    for (const [section, fields] of Object.entries(sections)) {
      byName.set(section, {
        name: section,
        source: "credentials",
        type: classify(fields),
      });
    }
  }

  if (existsSync(CONFIG_PATH)) {
    const sections = parseIni(readFileSync(CONFIG_PATH, "utf-8"));
    for (const [section, fields] of Object.entries(sections)) {
      const name = normalizeConfigSection(section);
      if (!name) continue;
      const existing = byName.get(name);
      const type = classify(fields);
      if (existing) {
        byName.set(name, {
          ...existing,
          source: "both",
          // Prefer the more specific type if one side says "other".
          type: existing.type === "other" ? type : existing.type,
        });
      } else {
        byName.set(name, { name, source: "config", type });
      }
    }
  }

  return [...byName.values()].sort((a, b) => a.name.localeCompare(b.name));
}

/** Exposed for tests — parses an INI string directly. */
export const __internal = { parseIni, normalizeConfigSection, classify };
