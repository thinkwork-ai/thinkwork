/**
 * Full plugin-bundle validator — the gate the U10 upload handler calls
 * before any byte of a tenant's plugin hits S3 or Aurora.
 *
 * Pipeline (fail-closed at every stage):
 *
 *   1. inspectZipBuffer — SI-4 guardrails: path escape, size, count,
 *      symlinks. Produces the in-memory entry map or a structured reject.
 *   2. parse plugin.json — JSON.parse + applyPluginFieldPolicy (HONOR /
 *      HARD_REJECT / WARN_IGNORE per the plan's policy table).
 *   3. parse every SKILL.md the plugin points at — parseSkillMd.
 *   4. carry mcp.json / inline mcpServers forward untouched; U10 stages
 *      them as tenant_mcp_servers rows with status='pending'.
 *
 * The validator never talks to AWS or the DB. It's deliberately a pure
 * function over a Buffer so tests can exercise every path in-memory.
 *
 * Result shape is structured so U10's admin UI can render specific
 * errors ("SKILL.md at skills/foo/SKILL.md missing required field
 * 'description'") rather than generic "plugin rejected."
 */

import {
  type HonoredPluginJson,
  type PluginPolicyError,
  type PluginPolicyWarning,
  applyPluginFieldPolicy,
} from "./plugin-field-policy.js";
import {
  type SkillMdError,
  type SkillMdParsed,
  parseSkillMd,
} from "./skill-md-parser.js";
import {
  type SafeZipEntry,
  type ZipSafetyError,
  inspectZipBuffer,
} from "./plugin-zip-safety.js";

/** Where the top-level plugin.json lives inside the zip. */
const PLUGIN_JSON_PATH = "plugin.json";
/** Optional standalone MCP server manifest. */
const MCP_JSON_PATH = "mcp.json";

export type PluginValidationErrorKind =
  | ZipSafetyError["kind"]
  | SkillMdError["kind"]
  | PluginPolicyError["kind"]
  | "PluginMissingPluginJson"
  | "PluginMissingSkill"
  | "PluginMissingMcpJson"
  | "PluginMalformedJson"
  | "PluginSkillPathNotADirectory";

export interface PluginValidationError {
  kind: PluginValidationErrorKind;
  message: string;
  details?: Record<string, unknown>;
}

export interface PluginValidationWarning {
  kind: "PluginFieldWarning" | "PluginAllowedToolsDeclared";
  message: string;
  details?: Record<string, unknown>;
}

export interface ValidatedMcpServer {
  name: string;
  url: string;
  auth?: Record<string, unknown>;
  description?: string;
  /** Which entry the record came from — `plugin.json` or `mcp.json`. */
  source: "plugin.json" | "mcp.json";
}

export interface ValidatedPlugin {
  name: string;
  version?: string;
  description?: string;
  author?: string;
  skills: SkillMdParsed[];
  mcpServers: ValidatedMcpServer[];
  agents: HonoredPluginJson["agents"];
  userConfig: HonoredPluginJson["userConfig"];
  /**
   * Flat list of `allowed-tools` from every SKILL.md in the bundle.
   * Informational — the runtime intersects with the session allowlist
   * at registration (plan §Key Technical Decisions).
   */
  allowedToolsDeclared: string[];
}

export type PluginValidationResult =
  | {
      valid: true;
      plugin: ValidatedPlugin;
      warnings: PluginValidationWarning[];
    }
  | {
      valid: false;
      errors: PluginValidationError[];
      warnings: PluginValidationWarning[];
    };

/**
 * Validate a plugin zip end-to-end. Pure function — no network, no FS.
 */
export async function validatePluginZip(
  zipBuffer: Buffer,
): Promise<PluginValidationResult> {
  // Stage 1 — zip safety. A reject here is terminal; we don't want to
  // even look at the structured contents of an archive that failed
  // SI-4 checks.
  const zipResult = await inspectZipBuffer(zipBuffer);
  if (!zipResult.valid) {
    return {
      valid: false,
      errors: zipResult.errors.map((e) => ({
        kind: e.kind,
        message: e.message,
        details: e.details,
      })),
      warnings: [],
    };
  }

  const warnings: PluginValidationWarning[] = [];
  const errors: PluginValidationError[] = [];
  const entriesByPath = new Map<string, SafeZipEntry>();
  for (const entry of zipResult.entries) {
    entriesByPath.set(normaliseEntryPath(entry.path), entry);
  }

  // Stage 2 — plugin.json parse + field policy.
  const pluginJsonEntry = entriesByPath.get(PLUGIN_JSON_PATH);
  if (!pluginJsonEntry) {
    return {
      valid: false,
      errors: [
        {
          kind: "PluginMissingPluginJson",
          message: `zip archive does not contain a top-level ${PLUGIN_JSON_PATH}`,
          details: { expected: PLUGIN_JSON_PATH },
        },
      ],
      warnings,
    };
  }

  let pluginJson: unknown;
  try {
    pluginJson = JSON.parse(pluginJsonEntry.text);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "PluginMalformedJson",
          message: `${PLUGIN_JSON_PATH} is not valid JSON`,
          details: { path: PLUGIN_JSON_PATH, cause: (e as Error).message },
        },
      ],
      warnings,
    };
  }

  const policyResult = applyPluginFieldPolicy(pluginJson);
  for (const w of policyResult.warnings) {
    warnings.push(policyToWarning(w));
  }
  if (!policyResult.valid) {
    return {
      valid: false,
      errors: policyResult.errors.map((e) => ({
        kind: e.kind,
        message: e.message,
        details: e.details,
      })),
      warnings,
    };
  }
  const honored = policyResult.honored;

  // Stage 3 — SKILL.md parse for each declared skill path. A plugin
  // that names skills without shipping the files is rejected; that's
  // the kind of manifest drift we want caught before the upload saga
  // ever stages anything to S3.
  const skills: SkillMdParsed[] = [];
  const allowedToolsDeclared: string[] = [];
  for (const skillPath of honored.skills ?? []) {
    const skillFile = resolveSkillMdEntry(entriesByPath, skillPath);
    if (!skillFile) {
      errors.push({
        kind: "PluginMissingSkill",
        message:
          `plugin.json references skill path '${skillPath}' but no ` +
          `SKILL.md entry was found at that location in the zip`,
        details: { path: skillPath },
      });
      continue;
    }
    const parsed = parseSkillMd(skillFile.text, skillFile.path);
    if (!parsed.valid) {
      for (const e of parsed.errors) {
        errors.push({
          kind: e.kind,
          message: e.message,
          details: e.details,
        });
      }
      continue;
    }
    skills.push(parsed.parsed);
    if (parsed.parsed.allowedToolsDeclared.length > 0) {
      warnings.push({
        kind: "PluginAllowedToolsDeclared",
        message:
          `skill '${parsed.parsed.name}' declares allowed-tools ` +
          `[${parsed.parsed.allowedToolsDeclared.join(", ")}]; the runtime ` +
          `intersects these with the session allowlist at registration.`,
        details: {
          slug: parsed.parsed.name,
          declared: parsed.parsed.allowedToolsDeclared,
        },
      });
      allowedToolsDeclared.push(...parsed.parsed.allowedToolsDeclared);
    }
  }

  // Stage 4 — MCP servers. Two shapes are accepted:
  //   * plugin.json.mcpServers (inline) — honored directly.
  //   * mcp.json at the zip root — optional standalone manifest that
  //     ALSO shapes as { mcpServers: [...] }. Both sources merge.
  const mcpServers: ValidatedMcpServer[] = [];
  for (const server of honored.mcpServers ?? []) {
    mcpServers.push({ ...server, source: "plugin.json" });
  }
  const mcpJsonEntry = entriesByPath.get(MCP_JSON_PATH);
  if (mcpJsonEntry) {
    try {
      const parsed = JSON.parse(mcpJsonEntry.text) as unknown;
      const extracted = extractMcpServersFromMcpJson(parsed);
      if (!extracted.valid) {
        for (const e of extracted.errors) errors.push(e);
      } else {
        mcpServers.push(...extracted.servers);
      }
    } catch (e) {
      errors.push({
        kind: "PluginMalformedJson",
        message: `${MCP_JSON_PATH} is not valid JSON`,
        details: { path: MCP_JSON_PATH, cause: (e as Error).message },
      });
    }
  }

  if (errors.length > 0) {
    return { valid: false, errors, warnings };
  }

  return {
    valid: true,
    plugin: {
      name: honored.name,
      version: honored.version,
      description: honored.description,
      author: honored.author,
      skills,
      mcpServers,
      agents: honored.agents,
      userConfig: honored.userConfig,
      allowedToolsDeclared,
    },
    warnings,
  };
}

/**
 * Zip entry paths may arrive with backslashes (Windows-produced zips) or
 * a leading `./`. Both are equivalent for lookup purposes; normalise
 * once at load time rather than sprinkling tolerances through the
 * lookups.
 */
function normaliseEntryPath(path: string): string {
  return path.replace(/\\/g, "/").replace(/^\.\//, "");
}

/**
 * Plugin.json `skills` entries can name either a SKILL.md path directly
 * or a directory that contains SKILL.md. Both shapes are supported by
 * Anthropic's spec; the harness tries the literal path first, then the
 * directory + SKILL.md form.
 */
function resolveSkillMdEntry(
  entriesByPath: Map<string, SafeZipEntry>,
  skillPath: string,
): SafeZipEntry | null {
  const normalised = normaliseEntryPath(skillPath);
  const direct = entriesByPath.get(normalised);
  if (direct && normalised.endsWith("SKILL.md")) {
    return direct;
  }
  const withSlash = normalised.endsWith("/") ? normalised : `${normalised}/`;
  const nested = entriesByPath.get(`${withSlash}SKILL.md`);
  if (nested) return nested;
  return null;
}

function policyToWarning(w: PluginPolicyWarning): PluginValidationWarning {
  return {
    kind: "PluginFieldWarning",
    message: w.message,
    details: { field: w.field },
  };
}

function extractMcpServersFromMcpJson(
  raw: unknown,
):
  | { valid: true; servers: ValidatedMcpServer[] }
  | { valid: false; errors: PluginValidationError[] } {
  if (raw === null || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [
        {
          kind: "PluginMalformedJson",
          message: `${MCP_JSON_PATH} must be an object with an 'mcpServers' array`,
          details: { path: MCP_JSON_PATH },
        },
      ],
    };
  }
  const container = raw as Record<string, unknown>;
  const list = container.mcpServers;
  if (!Array.isArray(list)) {
    return {
      valid: false,
      errors: [
        {
          kind: "PluginMalformedJson",
          message: `${MCP_JSON_PATH} top-level 'mcpServers' must be an array`,
          details: { path: MCP_JSON_PATH },
        },
      ],
    };
  }
  const out: ValidatedMcpServer[] = [];
  const errors: PluginValidationError[] = [];
  for (const item of list) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) {
      errors.push({
        kind: "PluginMalformedJson",
        message: `${MCP_JSON_PATH} 'mcpServers' entries must be objects`,
        details: { path: MCP_JSON_PATH },
      });
      continue;
    }
    const entry = item as Record<string, unknown>;
    if (typeof entry.name !== "string" || typeof entry.url !== "string") {
      errors.push({
        kind: "PluginMalformedJson",
        message: `${MCP_JSON_PATH} 'mcpServers' entry missing required 'name' or 'url'`,
        details: { path: MCP_JSON_PATH, entry },
      });
      continue;
    }
    const server: ValidatedMcpServer = {
      name: entry.name,
      url: entry.url,
      source: "mcp.json",
    };
    if (
      entry.auth &&
      typeof entry.auth === "object" &&
      !Array.isArray(entry.auth)
    ) {
      server.auth = entry.auth as Record<string, unknown>;
    }
    if (typeof entry.description === "string") {
      server.description = entry.description;
    }
    out.push(server);
  }
  if (errors.length > 0) {
    return { valid: false, errors };
  }
  return { valid: true, servers: out };
}
