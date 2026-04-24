/**
 * Plugin.json field policy — which top-level fields the thinkwork harness
 * supports when a tenant uploads a Claude Code plugin.
 *
 * Source of truth for the allow/deny split is the plan's §Key Technical
 * Decisions under "Reject Claude Code plugin fields that have no Strands
 * analogue." The plan breaks the field set into three buckets, enforced
 * by the three tables below:
 *
 *   HONOR        — fields the harness understands and will pass through
 *                  to the install pipeline. `name` is the only required
 *                  entry; everything else is optional.
 *   HARD_REJECT  — fields that correspond to Claude-Code-only concepts
 *                  with no Strands analogue (hooks, monitors, themes,
 *                  lspServers, outputStyles, bin, channels). Uploads
 *                  that include any of these fail closed — the plan's
 *                  stance is that writing it into a plugin.json is an
 *                  indication the tenant expected behaviour the
 *                  harness cannot provide.
 *   WARN_IGNORE  — `commands` is a Claude-Code UI-only concept; we
 *                  accept plugins that carry it but never expose the
 *                  commands. A warning rides through to the admin UI
 *                  so the operator knows the tenant's `commands/`
 *                  block will have no effect.
 *
 * The types below mirror the subset of Claude Code's plugin schema the
 * harness honours. Full schema reference:
 *   https://code.claude.com/docs/en/plugins-reference
 */

export interface PluginMcpServerSpec {
  name: string;
  url: string;
  /** Free-form auth config — U10 writes it into tenant_mcp_servers.auth_config. */
  auth?: Record<string, unknown>;
  /** Optional description shown in the admin MCP approval UI. */
  description?: string;
}

export interface PluginAgentSpec {
  name: string;
  /** Agent-level properties are plugin-specific; pass through verbatim. */
  [k: string]: unknown;
}

export interface PluginUserConfigEntry {
  key: string;
  /** Short label the admin UI shows the tenant when they enable the plugin. */
  label?: string;
  /** Free-form prompt the admin UI displays when asking the tenant for a value. */
  prompt?: string;
  secret?: boolean;
}

export interface HonoredPluginJson {
  /** Required. */
  name: string;
  version?: string;
  description?: string;
  author?: string;
  /** Relative paths to SKILL.md files shipped inside the zip. */
  skills?: string[];
  mcpServers?: PluginMcpServerSpec[];
  agents?: PluginAgentSpec[];
  userConfig?: PluginUserConfigEntry[];
}

export const HONORED_FIELDS = new Set<string>([
  "name",
  "version",
  "description",
  "author",
  "skills",
  "mcpServers",
  "agents",
  "userConfig",
]);

// Claude-Code-only features with no Strands analogue. Each entry's
// rejection message explains WHY the harness refuses, so tenants get
// actionable feedback instead of a generic "not supported."
export const HARD_REJECT_FIELDS: Record<string, string> = {
  hooks:
    "plugin.json 'hooks' is Claude-Code-CLI-only; the Strands runtime has no " +
    "equivalent lifecycle event surface.",
  monitors:
    "plugin.json 'monitors' is Claude-Code-CLI-only; the runtime's evaluation " +
    "pipeline (AgentCore Evaluations) is the equivalent.",
  themes:
    "plugin.json 'themes' is a Claude-Code terminal-UI concept; the admin " +
    "SPA and mobile client don't consume themes.",
  lspServers:
    "plugin.json 'lspServers' is Claude-Code-CLI-only; the runtime does not " +
    "host language-server integrations.",
  outputStyles:
    "plugin.json 'outputStyles' is a Claude-Code CLI output formatter; not " +
    "applicable to the Strands runtime.",
  bin:
    "plugin.json 'bin' installs CLI entry points into the Claude-Code PATH; " +
    "the runtime does not expose shell binaries.",
  channels:
    "plugin.json 'channels' is a Claude-Code CLI notification primitive; " +
    "the runtime uses the thread/message surface instead.",
};

// Fields the harness accepts but ignores. Each entry's warning explains
// WHAT the tenant loses so the admin UI can surface the compromise.
export const WARN_IGNORE_FIELDS: Record<string, string> = {
  commands:
    "plugin.json 'commands' is a Claude-Code slash-command UI primitive; " +
    "the admin SPA does not expose slash commands. The 'commands' block " +
    "will be ignored but the plugin will otherwise install.",
};

export type PluginPolicyErrorKind =
  | "PluginFieldRejected"
  | "PluginFieldType"
  | "PluginMissingRequired";

export interface PluginPolicyError {
  kind: PluginPolicyErrorKind;
  message: string;
  details: { field?: string; [k: string]: unknown };
}

export interface PluginPolicyWarning {
  field: string;
  message: string;
}

export type PluginPolicyResult =
  | { valid: true; honored: HonoredPluginJson; warnings: PluginPolicyWarning[] }
  | {
      valid: false;
      errors: PluginPolicyError[];
      warnings: PluginPolicyWarning[];
    };

/**
 * Apply the plugin.json policy table to a parsed JSON object.
 *
 * Returns the honored subset + any warnings (always safe to display) OR
 * the structured errors. The caller (plugin-validator.ts) composes this
 * with zip-safety and SKILL.md validation into the final upload-gate
 * result.
 */
export function applyPluginFieldPolicy(raw: unknown): PluginPolicyResult {
  const errors: PluginPolicyError[] = [];
  const warnings: PluginPolicyWarning[] = [];

  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [
        {
          kind: "PluginFieldType",
          message: "plugin.json top-level must be a JSON object",
          details: {
            got:
              raw === null ? "null" : Array.isArray(raw) ? "array" : typeof raw,
          },
        },
      ],
      warnings,
    };
  }

  const record = raw as Record<string, unknown>;

  // Pass 1: scan every top-level key and triage.
  for (const key of Object.keys(record)) {
    if (HARD_REJECT_FIELDS[key]) {
      errors.push({
        kind: "PluginFieldRejected",
        message: HARD_REJECT_FIELDS[key],
        details: { field: key },
      });
      continue;
    }
    if (WARN_IGNORE_FIELDS[key]) {
      warnings.push({ field: key, message: WARN_IGNORE_FIELDS[key] });
      continue;
    }
    if (!HONORED_FIELDS.has(key)) {
      // Unknown keys are softly rejected — a typo like `mcpserver`
      // instead of `mcpServers` should fail the upload, not silently
      // drop the block.
      errors.push({
        kind: "PluginFieldRejected",
        message: `plugin.json contains unknown field '${key}'`,
        details: { field: key },
      });
    }
  }

  // Early exit if the scan found hard-reject or unknown fields — no
  // point validating the honored subset against a plugin we're
  // refusing anyway.
  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  // Pass 2: validate the honored subset's shapes.
  const name = typeof record.name === "string" ? record.name : "";
  if (!name) {
    errors.push({
      kind: "PluginMissingRequired",
      message: "plugin.json is missing required field 'name'",
      details: { field: "name" },
    });
  }

  const honored: HonoredPluginJson = { name };
  if (record.version !== undefined) {
    if (typeof record.version !== "string") {
      errors.push(typeError("version", record.version));
    } else {
      honored.version = record.version;
    }
  }
  if (record.description !== undefined) {
    if (typeof record.description !== "string") {
      errors.push(typeError("description", record.description));
    } else {
      honored.description = record.description;
    }
  }
  if (record.author !== undefined) {
    if (typeof record.author !== "string") {
      errors.push(typeError("author", record.author));
    } else {
      honored.author = record.author;
    }
  }
  if (record.skills !== undefined) {
    const skills = validateStringArray(record.skills, "skills", errors);
    if (skills) honored.skills = skills;
  }
  if (record.mcpServers !== undefined) {
    const servers = validateMcpServers(record.mcpServers, errors);
    if (servers) honored.mcpServers = servers;
  }
  if (record.agents !== undefined) {
    const agents = validateAgentsArray(record.agents, errors);
    if (agents) honored.agents = agents;
  }
  if (record.userConfig !== undefined) {
    const userConfig = validateUserConfig(record.userConfig, errors);
    if (userConfig) honored.userConfig = userConfig;
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }
  return { valid: true, honored, warnings };
}

function typeError(field: string, got: unknown): PluginPolicyError {
  return {
    kind: "PluginFieldType",
    message: `plugin.json field '${field}' has wrong type (got ${describe(got)})`,
    details: { field, got: describe(got) },
  };
}

function validateStringArray(
  raw: unknown,
  field: string,
  errors: PluginPolicyError[],
): string[] | null {
  if (!Array.isArray(raw)) {
    errors.push(typeError(field, raw));
    return null;
  }
  const out: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push({
        kind: "PluginFieldType",
        message: `plugin.json field '${field}' contains non-string element`,
        details: { field, got: describe(item) },
      });
      return null;
    }
    out.push(item);
  }
  return out;
}

function validateMcpServers(
  raw: unknown,
  errors: PluginPolicyError[],
): PluginMcpServerSpec[] | null {
  if (!Array.isArray(raw)) {
    errors.push(typeError("mcpServers", raw));
    return null;
  }
  const out: PluginMcpServerSpec[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push({
        kind: "PluginFieldType",
        message: "plugin.json 'mcpServers' entries must be objects",
        details: { field: "mcpServers", got: describe(item) },
      });
      return null;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      errors.push({
        kind: "PluginMissingRequired",
        message: "plugin.json 'mcpServers' entry missing required 'name'",
        details: { field: "mcpServers.name" },
      });
      return null;
    }
    if (typeof entry.url !== "string" || entry.url.length === 0) {
      errors.push({
        kind: "PluginMissingRequired",
        message: `plugin.json 'mcpServers' entry '${entry.name}' missing required 'url'`,
        details: { field: "mcpServers.url", name: entry.name },
      });
      return null;
    }
    const server: PluginMcpServerSpec = {
      name: entry.name,
      url: entry.url,
    };
    if (entry.auth !== undefined) {
      if (
        entry.auth === null ||
        typeof entry.auth !== "object" ||
        Array.isArray(entry.auth)
      ) {
        errors.push({
          kind: "PluginFieldType",
          message: `plugin.json 'mcpServers' entry '${entry.name}' has non-object 'auth'`,
          details: { field: "mcpServers.auth", name: entry.name },
        });
        return null;
      }
      server.auth = entry.auth as Record<string, unknown>;
    }
    if (entry.description !== undefined) {
      if (typeof entry.description !== "string") {
        errors.push({
          kind: "PluginFieldType",
          message:
            `plugin.json 'mcpServers' entry '${entry.name}' has non-string ` +
            `'description'`,
          details: { field: "mcpServers.description", name: entry.name },
        });
        return null;
      }
      server.description = entry.description;
    }
    out.push(server);
  }
  return out;
}

function validateAgentsArray(
  raw: unknown,
  errors: PluginPolicyError[],
): PluginAgentSpec[] | null {
  if (!Array.isArray(raw)) {
    errors.push(typeError("agents", raw));
    return null;
  }
  const out: PluginAgentSpec[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push({
        kind: "PluginFieldType",
        message: "plugin.json 'agents' entries must be objects",
        details: { field: "agents", got: describe(item) },
      });
      return null;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string" || entry.name.length === 0) {
      errors.push({
        kind: "PluginMissingRequired",
        message: "plugin.json 'agents' entry missing required 'name'",
        details: { field: "agents.name" },
      });
      return null;
    }
    out.push(entry as PluginAgentSpec);
  }
  return out;
}

function validateUserConfig(
  raw: unknown,
  errors: PluginPolicyError[],
): PluginUserConfigEntry[] | null {
  if (!Array.isArray(raw)) {
    errors.push(typeError("userConfig", raw));
    return null;
  }
  const out: PluginUserConfigEntry[] = [];
  for (const item of raw) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push({
        kind: "PluginFieldType",
        message: "plugin.json 'userConfig' entries must be objects",
        details: { field: "userConfig", got: describe(item) },
      });
      return null;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.key !== "string" || entry.key.length === 0) {
      errors.push({
        kind: "PluginMissingRequired",
        message: "plugin.json 'userConfig' entry missing required 'key'",
        details: { field: "userConfig.key" },
      });
      return null;
    }
    const output: PluginUserConfigEntry = { key: entry.key };
    if (entry.label !== undefined) {
      if (typeof entry.label !== "string") {
        errors.push(typeError(`userConfig[${entry.key}].label`, entry.label));
        return null;
      }
      output.label = entry.label;
    }
    if (entry.prompt !== undefined) {
      if (typeof entry.prompt !== "string") {
        errors.push(typeError(`userConfig[${entry.key}].prompt`, entry.prompt));
        return null;
      }
      output.prompt = entry.prompt;
    }
    if (entry.secret !== undefined) {
      if (typeof entry.secret !== "boolean") {
        errors.push(typeError(`userConfig[${entry.key}].secret`, entry.secret));
        return null;
      }
      output.secret = entry.secret;
    }
    out.push(output);
  }
  return out;
}

function describe(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
