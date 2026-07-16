/**
 * Marker-file behavioral-config frontmatter (THINK-302 U2 — R4, R7, R10).
 *
 * The sidecar-retirement grammar: per-grant behavioral config that used to
 * live in `.assignment.json` moves into the marker file's YAML frontmatter —
 * SKILL.md, TOOL.md, CONNECTION.md, sub-agent INSTRUCTIONS.md, and the new
 * first-class `mcp/<slug>/MCP.md`. There is no `enabled` field anywhere:
 * folder presence is the grant, folder deletion is the revoke (R6).
 *
 * Field mapping from the retired sidecars (KTD-10):
 *   - `enabled`                → dropped (presence is the grant)
 *   - `permissions.operations` → `operations:` (CONNECTION.md keeps its
 *     existing `operations` field as the per-grant surface — same key,
 *     same meaning, no second list)
 *   - `approval`               → `approval:` (never|once|always)
 *   - `rate_limit_rpm`         → `rate_limit_rpm:`
 *   - `model_override`         → `model_override:`
 *   - `config`/`secretRef`/`registryServerId` → named frontmatter refs
 *     (`config:` map, MCP.md `server:`) — references only, never secrets
 *
 * Strict where the format is new (MCP.md: unknown keys are hard errors,
 * mirroring agent-folder-format.ts); shared-field validators compose into
 * the existing tolerant SKILL/TOOL/CONNECTION parsers at their call sites.
 * The serializer emits byte-stable block YAML — same input, identical
 * bytes, identical sha — because the backfill's deterministic merge and
 * the approval registry's marker_sha pins both depend on it.
 *
 * Ships inert in U2: exported but unconsumed until U3/U4 wire compile.
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { splitFrontmatter } from "../skill-md-parser.js";
import {
  APPROVAL_POLICIES,
  CAPABILITY_SLUG_PATTERN,
  scanForSecretValues,
  type ApprovalPolicy,
  type CapabilityDefinitionError,
} from "./definition-schemas.js";

/** Shared behavioral-config keys accepted on every marker class. */
export const MARKER_CONFIG_KEYS = [
  "approval",
  "operations",
  "rate_limit_rpm",
  "model_override",
  "config",
] as const;

/** MCP.md-only keys on top of the shared config set. */
export const MCP_MARKER_KEYS = [
  "name",
  "description",
  "server",
  "enabled_tools",
  ...MARKER_CONFIG_KEYS,
] as const;

/**
 * Literal secret material by VALUE shape, independent of the key name —
 * catches an `AKIA…` pasted into an innocently-named wiring ref (which the
 * key-name scan would let through, and whose all-caps shape would pass the
 * env-var-name reference allowance). Composes with `scanForSecretValues`.
 */
const SECRET_VALUE_RE =
  /^(?:AKIA[0-9A-Z]{16}|(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}|gh[pousr]_[A-Za-z0-9]{16,}|xox[baprs]-[A-Za-z0-9-]{10,}|eyJ[A-Za-z0-9_-]{16,}\.[A-Za-z0-9_-]+)/;
const PRIVATE_KEY_RE = /-----BEGIN [A-Z ]*PRIVATE KEY-----/;

export interface CapabilityMarkerConfig {
  /** Runtime HITL policy (R11). Absent in frontmatter = `never`. */
  approval: ApprovalPolicy;
  /** Granted operation allowlist. Absent = the class default surface. */
  operations?: string[];
  rateLimitRpm?: number;
  modelOverride?: string;
  /** Named wiring refs (string → reference string). Never secret values. */
  config?: Record<string, string>;
}

export interface McpMarkerDefinition extends CapabilityMarkerConfig {
  path: string;
  name: string;
  description: string;
  /**
   * Tenant MCP registry reference (`tenant_mcp_servers` row id or slug).
   * The endpoint URL and any credential stay platform-side — the dispatch
   * bridge resolves them from the registry (R10).
   */
  server: string;
  /** Enabled tool allowlist. Absent/empty = every tool the server offers. */
  enabledTools?: string[];
  /** The prose body, verbatim (trimmed). */
  body: string;
}

export type MarkerConfigResult =
  | { valid: true; parsed: CapabilityMarkerConfig }
  | { valid: false; errors: CapabilityDefinitionError[] };

export type McpMarkerResult =
  | { valid: true; parsed: McpMarkerDefinition }
  | { valid: false; errors: CapabilityDefinitionError[] };

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}

function secretLookingValue(value: string): boolean {
  // Specific secret shapes win over the reference allowance: an AWS access
  // key id (AKIA…) is all-caps-alnum and would otherwise pass as an
  // env-var-name style reference.
  return SECRET_VALUE_RE.test(value) || PRIVATE_KEY_RE.test(value);
}

function validateStringList(
  raw: unknown,
  field: string,
  path: string,
  errors: CapabilityDefinitionError[],
): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.some((item) => typeof item !== "string" || item.trim() === "")
  ) {
    errors.push({
      kind: "FieldType",
      message: `${path} field '${field}' must be a list of non-empty strings`,
      details: { path, field, got: describeType(raw) },
    });
    return undefined;
  }
  return (raw as string[]).map((item) => item.trim());
}

/**
 * Validate the shared behavioral-config subset out of an already-parsed
 * frontmatter record. Reads ONLY the `MARKER_CONFIG_KEYS`; ownership of
 * unknown-key strictness stays with each marker's own parser.
 */
export function validateMarkerConfigFields(
  record: Record<string, unknown>,
  path: string,
  errors: CapabilityDefinitionError[],
): CapabilityMarkerConfig {
  let approval: ApprovalPolicy = "never";
  if (record.approval !== undefined && record.approval !== null) {
    if (
      typeof record.approval === "string" &&
      (APPROVAL_POLICIES as readonly string[]).includes(record.approval)
    ) {
      approval = record.approval as ApprovalPolicy;
    } else {
      errors.push({
        kind: "FieldShape",
        message:
          `${path} field 'approval' must be one of ` +
          `${APPROVAL_POLICIES.join("|")} (got ${JSON.stringify(record.approval)})`,
        details: { path, field: "approval", value: record.approval },
      });
    }
  }

  const operations = validateStringList(
    record.operations,
    "operations",
    path,
    errors,
  );

  let rateLimitRpm: number | undefined;
  if (record.rate_limit_rpm !== undefined && record.rate_limit_rpm !== null) {
    if (
      typeof record.rate_limit_rpm !== "number" ||
      !Number.isInteger(record.rate_limit_rpm) ||
      record.rate_limit_rpm <= 0
    ) {
      errors.push({
        kind: "FieldShape",
        message: `${path} field 'rate_limit_rpm' must be a positive integer`,
        details: {
          path,
          field: "rate_limit_rpm",
          value: record.rate_limit_rpm,
        },
      });
    } else {
      rateLimitRpm = record.rate_limit_rpm;
    }
  }

  let modelOverride: string | undefined;
  if (record.model_override !== undefined && record.model_override !== null) {
    if (
      typeof record.model_override !== "string" ||
      record.model_override.trim() === ""
    ) {
      errors.push({
        kind: "FieldType",
        message: `${path} field 'model_override' must be a non-empty string`,
        details: { path, field: "model_override" },
      });
    } else {
      modelOverride = record.model_override.trim();
    }
  }

  let config: Record<string, string> | undefined;
  if (record.config !== undefined && record.config !== null) {
    if (
      typeof record.config !== "object" ||
      Array.isArray(record.config) ||
      Object.values(record.config as Record<string, unknown>).some(
        (value) => typeof value !== "string",
      )
    ) {
      errors.push({
        kind: "FieldType",
        message: `${path} field 'config' must be a flat mapping of string references`,
        details: { path, field: "config", got: describeType(record.config) },
      });
    } else {
      const entries = record.config as Record<string, string>;
      scanForSecretValues(entries, "config", path, errors);
      for (const [key, value] of Object.entries(entries)) {
        if (secretLookingValue(value)) {
          errors.push({
            kind: "SecretValue",
            message:
              `${path}: field 'config.${key}' looks like a literal secret ` +
              `value — marker frontmatter carries references only ` +
              `(secretsmanager:/ssm:/ref:/ENV_VAR_NAME)`,
            details: { path, field: `config.${key}` },
          });
        }
      }
      config = entries;
    }
  }

  return {
    approval,
    ...(operations && operations.length > 0 ? { operations } : {}),
    ...(rateLimitRpm !== undefined ? { rateLimitRpm } : {}),
    ...(modelOverride !== undefined ? { modelOverride } : {}),
    ...(config ? { config } : {}),
  };
}

/**
 * Parse a marker frontmatter record that carries ONLY behavioral config —
 * the strict entry used by tests and by callers that already isolated the
 * config subset. Unknown keys are hard errors.
 */
export function parseMarkerConfig(
  record: Record<string, unknown>,
  path: string,
): MarkerConfigResult {
  const errors: CapabilityDefinitionError[] = [];
  for (const key of Object.keys(record)) {
    if ((MARKER_CONFIG_KEYS as readonly string[]).includes(key)) continue;
    errors.push({
      kind: "FieldShape",
      message:
        `${path}: unknown behavioral-config key '${key}' — ` +
        `allowed: ${MARKER_CONFIG_KEYS.join(", ")}`,
      details: { path, field: key },
    });
  }
  const parsed = validateMarkerConfigFields(record, path, errors);
  if (errors.length > 0) return { valid: false, errors };
  return { valid: true, parsed };
}

/** Parse + validate an `mcp/<slug>/MCP.md` document. Strict from day one. */
export function parseMcpDefinition(
  source: string,
  path: string,
): McpMarkerResult {
  const split = splitFrontmatter(source);
  if (split === null) {
    return {
      valid: false,
      errors: [
        {
          kind: "MissingFrontmatter",
          message: `MCP.md at ${path} has no '---' frontmatter block`,
          details: { path },
        },
      ],
    };
  }
  let raw: unknown;
  try {
    raw = parseYaml(split.yaml);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "MalformedFrontmatter",
          message: `MCP.md at ${path} has malformed YAML frontmatter`,
          details: { path, cause: (e as Error).message },
        },
      ],
    };
  }
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
    return {
      valid: false,
      errors: [
        {
          kind: "MalformedFrontmatter",
          message: `MCP.md at ${path} frontmatter is not a mapping`,
          details: { path, got: describeType(raw) },
        },
      ],
    };
  }

  const record = raw as Record<string, unknown>;
  const errors: CapabilityDefinitionError[] = [];

  for (const key of Object.keys(record)) {
    if ((MCP_MARKER_KEYS as readonly string[]).includes(key)) continue;
    if (key === "enabled") {
      errors.push({
        kind: "FieldShape",
        message:
          `${path}: 'enabled' is not a marker field — folder presence is ` +
          `the grant, folder deletion is the revoke`,
        details: { path, field: key },
      });
      continue;
    }
    errors.push({
      kind: "FieldShape",
      message:
        `${path}: unknown frontmatter key '${key}' — the MCP.md format is ` +
        `strict (allowed: ${MCP_MARKER_KEYS.join(", ")})`,
      details: { path, field: key },
    });
  }

  let name: string | null = null;
  if (typeof record.name !== "string" || record.name === "") {
    errors.push({
      kind: "MissingField",
      message: `${path} is missing required field 'name'`,
      details: { path, field: "name" },
    });
  } else if (!CAPABILITY_SLUG_PATTERN.test(record.name)) {
    errors.push({
      kind: "FieldShape",
      message: `${path} field 'name' must match ${CAPABILITY_SLUG_PATTERN.source} (got "${record.name}")`,
      details: { path, field: "name", value: record.name },
    });
  } else {
    name = record.name;
  }

  let description: string | null = null;
  if (typeof record.description !== "string" || record.description === "") {
    errors.push({
      kind: "MissingField",
      message: `${path} is missing required field 'description'`,
      details: { path, field: "description" },
    });
  } else {
    description = record.description.trim();
  }

  let server: string | null = null;
  if (typeof record.server !== "string" || record.server.trim() === "") {
    errors.push({
      kind: "MissingField",
      message:
        `${path} is missing required field 'server' — the tenant MCP ` +
        `registry reference this grant dials through`,
      details: { path, field: "server" },
    });
  } else {
    server = record.server.trim();
  }

  const enabledTools = validateStringList(
    record.enabled_tools,
    "enabled_tools",
    path,
    errors,
  );
  const config = validateMarkerConfigFields(record, path, errors);

  if (errors.length > 0 || !name || !description || !server) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    parsed: {
      path,
      name,
      description,
      server,
      ...(enabledTools && enabledTools.length > 0 ? { enabledTools } : {}),
      ...config,
      body: split.body.trim(),
    },
  };
}

/** Canonical key order the serializer emits — the byte-stability contract. */
const SERIALIZE_KEY_ORDER = [
  "name",
  "description",
  "server",
  "enabled_tools",
  "approval",
  "operations",
  "rate_limit_rpm",
  "model_override",
  "config",
] as const;

export interface McpMarkerSerializeInput {
  name: string;
  description: string;
  server: string;
  enabledTools?: string[];
  approval?: ApprovalPolicy;
  operations?: string[];
  rateLimitRpm?: number;
  modelOverride?: string;
  config?: Record<string, string>;
  body?: string;
}

/**
 * Byte-stable serialization: fixed key order, block YAML, defaults elided
 * (`approval: never` is the absence default and is not written), sorted
 * `config` keys, single trailing newline. Same logical input always
 * produces identical bytes — identical marker sha.
 */
export function serializeMcpDefinition(input: McpMarkerSerializeInput): string {
  const frontmatter: Record<string, unknown> = {};
  const fields: Record<string, unknown> = {
    name: input.name.trim(),
    description: input.description.trim(),
    server: input.server.trim(),
    ...(input.enabledTools && input.enabledTools.length > 0
      ? { enabled_tools: input.enabledTools.map((tool) => tool.trim()) }
      : {}),
    ...(input.approval && input.approval !== "never"
      ? { approval: input.approval }
      : {}),
    ...(input.operations && input.operations.length > 0
      ? { operations: input.operations.map((op) => op.trim()) }
      : {}),
    ...(input.rateLimitRpm !== undefined
      ? { rate_limit_rpm: input.rateLimitRpm }
      : {}),
    ...(input.modelOverride?.trim()
      ? { model_override: input.modelOverride.trim() }
      : {}),
    ...(input.config && Object.keys(input.config).length > 0
      ? {
          config: Object.fromEntries(
            Object.entries(input.config).sort(([a], [b]) =>
              a < b ? -1 : a > b ? 1 : 0,
            ),
          ),
        }
      : {}),
  };
  for (const key of SERIALIZE_KEY_ORDER) {
    if (fields[key] !== undefined) frontmatter[key] = fields[key];
  }
  const yaml = stringifyYaml(frontmatter, { collectionStyle: "block" }).trim();
  const body = (input.body ?? "").trim();
  return body ? `---\n${yaml}\n---\n\n${body}\n` : `---\n${yaml}\n---\n`;
}
