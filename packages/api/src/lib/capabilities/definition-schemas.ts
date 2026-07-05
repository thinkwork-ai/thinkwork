/**
 * Declarative definition schemas for workspace capability folders
 * (THINK-173 plan U1 — `connections/<slug>/CONNECTION.md` and
 * `tools/<slug>/TOOL.md`, each beside a platform-signed
 * `.assignment.json` sidecar).
 *
 * Definition files are Claude-skill-shaped markdown: YAML frontmatter
 * carries the structured declaration, the prose body documents the
 * capability for humans and the model. They are *declarative only* —
 * implementations live in the platform runtime, in approved dynamic
 * extensions, or behind connections. The single exception is
 * `script`-kind tools, whose sandbox payload lives in the folder but
 * registers only after a trust-gate pass (plan U8).
 *
 * Sidecars carry per-assignment state (enabled, permissions.operations,
 * approval policy, credential wiring refs) and the signature envelope
 * that makes them registration-grade (R3). Never secret values (R2):
 * any secret-shaped key must hold a reference, and the schema rejects
 * literal secret material at parse time.
 */

import {
  splitFrontmatter,
  NAME_PATTERN,
  MAX_DESCRIPTION_LEN,
} from "../skill-md-parser.js";
import { parse as parseYaml } from "yaml";
import type { CapabilitySignatureEnvelope } from "./sidecar-signing.js";

export const CONNECTION_DEFINITION_FILE = "CONNECTION.md";
export const TOOL_DEFINITION_FILE = "TOOL.md";
export const CAPABILITY_SIDECAR_FILE = ".assignment.json";

export const TOOL_KINDS = [
  "binding",
  "platform",
  "extension",
  "script",
] as const;
export type ToolKind = (typeof TOOL_KINDS)[number];

export const CONNECTION_TYPES = ["mcp", "api"] as const;
export type ConnectionType = (typeof CONNECTION_TYPES)[number];

export const CONNECTION_PRINCIPAL_TYPES = ["app", "user"] as const;
export type ConnectionPrincipalType =
  (typeof CONNECTION_PRINCIPAL_TYPES)[number];

/** Forward-declared approval policy (R: declared, bluntly enforced in v1). */
export const APPROVAL_POLICIES = ["never", "once", "always"] as const;
export type ApprovalPolicy = (typeof APPROVAL_POLICIES)[number];

export interface CapabilityDefinitionError {
  kind:
    | "MissingFrontmatter"
    | "MalformedFrontmatter"
    | "MissingField"
    | "FieldType"
    | "FieldShape"
    | "FieldTooLong"
    | "UnknownKind"
    | "SecretValue";
  message: string;
  details: { path: string; field?: string; [k: string]: unknown };
}

export interface ConnectionDefinition {
  path: string;
  name: string;
  description: string;
  type: ConnectionType;
  /** Whose credential satisfies this connection. Default `app`. */
  principalType: ConnectionPrincipalType;
  /** MCP endpoint / API base URL. Reference material, no secrets. */
  url?: string;
  /**
   * Declared operation surface (tool names for mcp, operation ids for
   * api). Bindings scope against this list; empty = discovered.
   */
  operations: string[];
  /**
   * Auth *shape* declaration — method + refs only (e.g. `method`,
   * `token_env`, `secret_ref`). Secret-shaped keys must be references;
   * enforced by the secret scan.
   */
  auth?: Record<string, unknown>;
  /** Prose body. */
  body: string;
  /** Remaining frontmatter fields, preserved verbatim. */
  internal: Record<string, unknown>;
}

interface ToolDefinitionBase {
  path: string;
  name: string;
  description: string;
  kind: ToolKind;
  body: string;
  internal: Record<string, unknown>;
}

export interface BindingToolDefinition extends ToolDefinitionBase {
  kind: "binding";
  /** Slug of the admitted connection this binding wraps. */
  connection: string;
  /** Operation of the connection this tool exposes. */
  operation: string;
  /** Preset arguments merged under the model's arguments. */
  presetArgs: Record<string, unknown>;
  /** Output shaping — what the model sees vs what the thread renders. */
  output?: { model?: string; thread?: string };
}

export interface PlatformToolDefinition extends ToolDefinitionBase {
  kind: "platform";
  /** Runtime built-in this declaration enables (e.g. `send_email`). */
  platformTool: string;
  config: Record<string, unknown>;
}

export interface ExtensionToolDefinition extends ToolDefinitionBase {
  kind: "extension";
  /** Approved dynamic Pi extension id. */
  extension: string;
  /** Tool name within the extension. */
  tool: string;
}

export interface ScriptToolDefinition extends ToolDefinitionBase {
  kind: "script";
  /** Folder-relative entry point executed in the sandbox. */
  entry: string;
}

export type ToolDefinition =
  | BindingToolDefinition
  | PlatformToolDefinition
  | ExtensionToolDefinition
  | ScriptToolDefinition;

export type ConnectionDefinitionResult =
  | { valid: true; parsed: ConnectionDefinition }
  | { valid: false; errors: CapabilityDefinitionError[] };

export type ToolDefinitionResult =
  | { valid: true; parsed: ToolDefinition }
  | { valid: false; errors: CapabilityDefinitionError[] };

/**
 * Per-assignment sidecar state (mirrors `SkillAssignmentState` — the
 * `skills/<slug>/.assignment.json` precedent). Signed sidecars are the
 * only registration-grade state; presence of the definition file alone
 * activates nothing (R3).
 */
export interface CapabilityAssignmentSidecar {
  slug: string;
  class: "connection" | "tool";
  /** Absent = enabled. */
  enabled?: boolean;
  /** { operations?: string[] } — the authz allowlist. */
  permissions?: { operations?: string[] } & Record<string, unknown>;
  /** Declared policy; in v1 anything gated is withheld from the manifest. */
  approval?: ApprovalPolicy;
  /** Credential/OAuth wiring — references only, never token values. */
  config?: Record<string, unknown>;
  /** sha256 of the definition file bytes pinned at signing time (R18). */
  signed_content_sha?: string;
  /** Platform signature envelope (absent = unsigned draft/proposal). */
  signature?: CapabilitySignatureEnvelope;
  updated_at: string;
}

export type CapabilitySidecarResult =
  | { valid: true; parsed: CapabilityAssignmentSidecar }
  | { valid: false; errors: CapabilityDefinitionError[] };

/** Parse + validate a CONNECTION.md document. */
export function parseConnectionDefinition(
  source: string,
  path: string,
): ConnectionDefinitionResult {
  const front = parseCapabilityFrontmatter(source, path, "CONNECTION.md");
  if (!front.ok) return { valid: false, errors: front.errors };
  const { record, body } = front;
  const errors: CapabilityDefinitionError[] = [];

  const name = requireSlug(record.name, path, errors);
  const description = requireDescription(record.description, path, errors);
  const type = requireEnum(
    record.type,
    CONNECTION_TYPES,
    "type",
    path,
    errors,
  );
  const principalType =
    record.principal_type === undefined || record.principal_type === null
      ? "app"
      : requireEnum(
          record.principal_type,
          CONNECTION_PRINCIPAL_TYPES,
          "principal_type",
          path,
          errors,
        );
  const url = optionalString(record.url, "url", path, errors);
  const operations = optionalStringList(
    record.operations,
    "operations",
    path,
    errors,
  );
  const auth = optionalRecord(record.auth, "auth", path, errors);
  if (auth) scanForSecretValues(auth, "auth", path, errors);

  if (errors.length > 0 || !name || !description || !type || !principalType) {
    return { valid: false, errors };
  }
  return {
    valid: true,
    parsed: {
      path,
      name,
      description,
      type,
      principalType,
      ...(url ? { url } : {}),
      operations: operations ?? [],
      ...(auth ? { auth } : {}),
      body,
      internal: stripKnown(record, [
        "name",
        "description",
        "type",
        "principal_type",
        "url",
        "operations",
        "auth",
      ]),
    },
  };
}

/** Parse + validate a TOOL.md document (kind-discriminated). */
export function parseToolDefinition(
  source: string,
  path: string,
): ToolDefinitionResult {
  const front = parseCapabilityFrontmatter(source, path, "TOOL.md");
  if (!front.ok) return { valid: false, errors: front.errors };
  const { record, body } = front;
  const errors: CapabilityDefinitionError[] = [];

  const name = requireSlug(record.name, path, errors);
  const description = requireDescription(record.description, path, errors);
  const kindRaw = record.kind;
  if (typeof kindRaw !== "string" || kindRaw === "") {
    errors.push({
      kind: "MissingField",
      message: `TOOL.md at ${path} is missing required field 'kind'`,
      details: { path, field: "kind" },
    });
    return { valid: false, errors };
  }
  if (!(TOOL_KINDS as readonly string[]).includes(kindRaw)) {
    errors.push({
      kind: "UnknownKind",
      message:
        `TOOL.md at ${path} field 'kind' must be one of ` +
        `[${TOOL_KINDS.join(", ")}] (got "${kindRaw}")`,
      details: { path, field: "kind", value: kindRaw, allowed: TOOL_KINDS },
    });
    return { valid: false, errors };
  }
  const kind = kindRaw as ToolKind;
  scanForSecretValues(record, "", path, errors);

  const base = { path, body } as const;
  let parsed: ToolDefinition | null = null;
  switch (kind) {
    case "binding": {
      const connection = requireSlug(
        record.connection,
        path,
        errors,
        "connection",
      );
      const operation = requireString(
        record.operation,
        "operation",
        path,
        errors,
      );
      const presetArgs =
        optionalRecord(record.args, "args", path, errors) ?? {};
      const output = parseOutputShaping(record.output, path, errors);
      if (name && description && connection && operation) {
        parsed = {
          ...base,
          name,
          description,
          kind,
          connection,
          operation,
          presetArgs,
          ...(output ? { output } : {}),
          internal: stripKnown(record, [
            "name",
            "description",
            "kind",
            "connection",
            "operation",
            "args",
            "output",
          ]),
        };
      }
      break;
    }
    case "platform": {
      const platformTool = requireString(
        record.platform_tool,
        "platform_tool",
        path,
        errors,
      );
      const config =
        optionalRecord(record.config, "config", path, errors) ?? {};
      if (name && description && platformTool) {
        parsed = {
          ...base,
          name,
          description,
          kind,
          platformTool,
          config,
          internal: stripKnown(record, [
            "name",
            "description",
            "kind",
            "platform_tool",
            "config",
          ]),
        };
      }
      break;
    }
    case "extension": {
      const extension = requireString(
        record.extension,
        "extension",
        path,
        errors,
      );
      const tool = requireString(record.tool, "tool", path, errors);
      if (name && description && extension && tool) {
        parsed = {
          ...base,
          name,
          description,
          kind,
          extension,
          tool,
          internal: stripKnown(record, [
            "name",
            "description",
            "kind",
            "extension",
            "tool",
          ]),
        };
      }
      break;
    }
    case "script": {
      const entry = requireString(record.entry, "entry", path, errors);
      if (name && description && entry) {
        parsed = {
          ...base,
          name,
          description,
          kind,
          entry,
          internal: stripKnown(record, [
            "name",
            "description",
            "kind",
            "entry",
          ]),
        };
      }
      break;
    }
  }

  if (errors.length > 0 || !parsed) return { valid: false, errors };
  return { valid: true, parsed };
}

/** Parse + validate a capability `.assignment.json` sidecar document. */
export function parseCapabilitySidecar(
  source: string,
  path: string,
): CapabilitySidecarResult {
  let raw: unknown;
  try {
    raw = JSON.parse(source);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "MalformedFrontmatter",
          message: `sidecar at ${path} is not valid JSON`,
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
          kind: "FieldType",
          message: `sidecar at ${path} must be a JSON object`,
          details: { path, got: describeType(raw) },
        },
      ],
    };
  }
  const record = raw as Record<string, unknown>;
  const errors: CapabilityDefinitionError[] = [];

  const slug = requireSlug(record.slug, path, errors, "slug");
  const klass = requireEnum(
    record.class,
    ["connection", "tool"] as const,
    "class",
    path,
    errors,
  );
  const updatedAt = requireString(
    record.updated_at,
    "updated_at",
    path,
    errors,
  );
  if (record.enabled !== undefined && typeof record.enabled !== "boolean") {
    errors.push({
      kind: "FieldType",
      message: `sidecar at ${path} field 'enabled' must be boolean`,
      details: { path, field: "enabled", got: describeType(record.enabled) },
    });
  }
  if (
    record.approval !== undefined &&
    !(APPROVAL_POLICIES as readonly string[]).includes(
      record.approval as string,
    )
  ) {
    errors.push({
      kind: "FieldShape",
      message:
        `sidecar at ${path} field 'approval' must be one of ` +
        `[${APPROVAL_POLICIES.join(", ")}]`,
      details: { path, field: "approval", value: record.approval },
    });
  }
  const permissions = optionalRecord(
    record.permissions,
    "permissions",
    path,
    errors,
  );
  const config = optionalRecord(record.config, "config", path, errors);
  if (config) scanForSecretValues(config, "config", path, errors);
  if (
    record.signed_content_sha !== undefined &&
    (typeof record.signed_content_sha !== "string" ||
      !/^[a-f0-9]{64}$/i.test(record.signed_content_sha))
  ) {
    errors.push({
      kind: "FieldShape",
      message: `sidecar at ${path} field 'signed_content_sha' must be a sha256 hex digest`,
      details: { path, field: "signed_content_sha" },
    });
  }

  if (errors.length > 0 || !slug || !klass || !updatedAt) {
    return { valid: false, errors };
  }
  return { valid: true, parsed: record as unknown as CapabilityAssignmentSidecar };
}

/**
 * R2 enforcement — secret-shaped keys must hold references, never
 * literal secret material. Accepted reference shapes: Secrets Manager /
 * SSM refs, ARNs, `ref:` markers, and env-var-name style values.
 */
const SECRET_KEY_RE =
  /(?:^|_)(?:token|secret|password|apikey|api_key|client_secret|private_key|credentials?|authorization)$/i;
const ALLOWED_REF_RE =
  /^(?:secretsmanager:|ssm:|ref:|arn:aws:secretsmanager:|arn:aws:ssm:|[A-Z][A-Z0-9_]*$)/;

function scanForSecretValues(
  value: unknown,
  keyPath: string,
  path: string,
  errors: CapabilityDefinitionError[],
): void {
  if (!value || typeof value !== "object") return;
  for (const [key, child] of Object.entries(
    value as Record<string, unknown>,
  )) {
    const childPath = keyPath ? `${keyPath}.${key}` : key;
    if (
      SECRET_KEY_RE.test(key) &&
      typeof child === "string" &&
      child !== "" &&
      !ALLOWED_REF_RE.test(child)
    ) {
      errors.push({
        kind: "SecretValue",
        message:
          `${path}: field '${childPath}' looks like a literal secret value — ` +
          `capability files carry references only (secretsmanager:/ssm:/ref:/ENV_VAR_NAME)`,
        details: { path, field: childPath },
      });
    }
    if (child && typeof child === "object" && !Array.isArray(child)) {
      scanForSecretValues(child, childPath, path, errors);
    }
  }
}

function parseCapabilityFrontmatter(
  source: string,
  path: string,
  label: string,
):
  | { ok: true; record: Record<string, unknown>; body: string }
  | { ok: false; errors: CapabilityDefinitionError[] } {
  const split = splitFrontmatter(source);
  if (split === null) {
    return {
      ok: false,
      errors: [
        {
          kind: "MissingFrontmatter",
          message: `${label} at ${path} has no '---' frontmatter block`,
          details: { path },
        },
      ],
    };
  }
  let fm: unknown;
  try {
    fm = parseYaml(split.yaml);
  } catch (e) {
    return {
      ok: false,
      errors: [
        {
          kind: "MalformedFrontmatter",
          message: `${label} at ${path} has malformed YAML frontmatter`,
          details: { path, cause: (e as Error).message },
        },
      ],
    };
  }
  if (!fm || typeof fm !== "object" || Array.isArray(fm)) {
    return {
      ok: false,
      errors: [
        {
          kind: "MalformedFrontmatter",
          message: `${label} at ${path} frontmatter is not a mapping`,
          details: { path, got: describeType(fm) },
        },
      ],
    };
  }
  return { ok: true, record: fm as Record<string, unknown>, body: split.body };
}

function requireSlug(
  raw: unknown,
  path: string,
  errors: CapabilityDefinitionError[],
  field = "name",
): string | null {
  if (typeof raw !== "string" || raw === "") {
    errors.push({
      kind: "MissingField",
      message: `${path} is missing required field '${field}'`,
      details: { path, field },
    });
    return null;
  }
  if (!NAME_PATTERN.test(raw)) {
    errors.push({
      kind: "FieldShape",
      message: `${path} field '${field}' must match ${NAME_PATTERN.source} (got "${raw}")`,
      details: { path, field, value: raw },
    });
    return null;
  }
  return raw;
}

function requireDescription(
  raw: unknown,
  path: string,
  errors: CapabilityDefinitionError[],
): string | null {
  if (typeof raw !== "string" || raw === "") {
    errors.push({
      kind: "MissingField",
      message: `${path} is missing required field 'description'`,
      details: { path, field: "description" },
    });
    return null;
  }
  if (raw.length > MAX_DESCRIPTION_LEN) {
    errors.push({
      kind: "FieldTooLong",
      message: `${path} field 'description' is ${raw.length} chars (max ${MAX_DESCRIPTION_LEN})`,
      details: { path, field: "description", length: raw.length },
    });
    return null;
  }
  return raw;
}

function requireString(
  raw: unknown,
  field: string,
  path: string,
  errors: CapabilityDefinitionError[],
): string | null {
  if (typeof raw !== "string" || raw === "") {
    errors.push({
      kind: "MissingField",
      message: `${path} is missing required field '${field}'`,
      details: { path, field },
    });
    return null;
  }
  return raw;
}

function requireEnum<T extends string>(
  raw: unknown,
  allowed: readonly T[],
  field: string,
  path: string,
  errors: CapabilityDefinitionError[],
): T | null {
  if (typeof raw !== "string" || !(allowed as readonly string[]).includes(raw)) {
    errors.push({
      kind: raw === undefined || raw === null ? "MissingField" : "FieldShape",
      message: `${path} field '${field}' must be one of [${allowed.join(", ")}]`,
      details: { path, field, value: raw ?? null },
    });
    return null;
  }
  return raw as T;
}

function optionalString(
  raw: unknown,
  field: string,
  path: string,
  errors: CapabilityDefinitionError[],
): string | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "string") {
    errors.push({
      kind: "FieldType",
      message: `${path} field '${field}' must be a string`,
      details: { path, field, got: describeType(raw) },
    });
    return undefined;
  }
  return raw;
}

function optionalStringList(
  raw: unknown,
  field: string,
  path: string,
  errors: CapabilityDefinitionError[],
): string[] | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (
    !Array.isArray(raw) ||
    raw.some((item) => typeof item !== "string" || item === "")
  ) {
    errors.push({
      kind: "FieldType",
      message: `${path} field '${field}' must be a list of non-empty strings`,
      details: { path, field },
    });
    return undefined;
  }
  return raw as string[];
}

function optionalRecord(
  raw: unknown,
  field: string,
  path: string,
  errors: CapabilityDefinitionError[],
): Record<string, unknown> | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({
      kind: "FieldType",
      message: `${path} field '${field}' must be a mapping`,
      details: { path, field, got: describeType(raw) },
    });
    return undefined;
  }
  return raw as Record<string, unknown>;
}

function parseOutputShaping(
  raw: unknown,
  path: string,
  errors: CapabilityDefinitionError[],
): { model?: string; thread?: string } | undefined {
  const record = optionalRecord(raw, "output", path, errors);
  if (!record) return undefined;
  const out: { model?: string; thread?: string } = {};
  if (record.model !== undefined) {
    const model = optionalString(record.model, "output.model", path, errors);
    if (model) out.model = model;
  }
  if (record.thread !== undefined) {
    const thread = optionalString(
      record.thread,
      "output.thread",
      path,
      errors,
    );
    if (thread) out.thread = thread;
  }
  return out;
}

function stripKnown(
  record: Record<string, unknown>,
  known: string[],
): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (known.includes(k)) continue;
    out[k] = v;
  }
  return out;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
