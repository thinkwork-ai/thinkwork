/**
 * Strict parser/serializer for the agent-folder format
 * (subagent-folders plan 2026-07-15-001, U3 — R1/R2/R3).
 *
 * An agent folder is `agents/<slug>/` holding an `INSTRUCTIONS.md` whose
 * YAML frontmatter carries the typed config (`description` required,
 * `model`/`enabled`/`execution` optional) above a pure-prose body, plus an
 * optional `.assignment.json` sidecar recording platform state (disabled,
 * pending agent-authored edits, execution overrides).
 *
 * Schema amnesty: this format is strict from day one — unknown keys and
 * legacy alias names (`toolPolicy`, `executionControls`, `modelId`,
 * frontmatter `instructions`, `skills`/`mcpServers` grant lists, …) are
 * hard errors, never silently accepted. The tolerant legacy parser for
 * `agents/<slug>.md` lives in `agent-profile-workspace-files.ts` and is
 * frozen; migrate-on-touch (U12) is the only bridge between the two.
 *
 * Grants are NOT declared here: a sub-agent's skill/connector surface is
 * the presence of `skills/<slug>/` and `connectors/<slug>/` folders inside
 * the agent folder (folders-are-the-grants).
 */

import { parse as parseYaml, stringify as stringifyYaml } from "yaml";
import { MAX_DESCRIPTION_LEN, splitFrontmatter } from "./skill-md-parser.js";
import type { CapabilityDefinitionError } from "./capabilities/definition-schemas.js";
import { CAPABILITY_SLUG_PATTERN } from "./capabilities/definition-schemas.js";
import {
  AGENT_LOOP_MODES,
  EXTERNAL_REVIEWER_POLICIES,
  LOOP_FAIL_BEHAVIORS,
  normalizeAgentLoopPolicy,
  type AgentLoopPolicy,
} from "./agent-profile-loop-policy.js";

export const AGENT_INSTRUCTIONS_FILE = "INSTRUCTIONS.md";

const AGENT_FOLDER_INSTRUCTIONS_RE =
  /^agents\/([a-z0-9][a-z0-9-]*)\/INSTRUCTIONS\.md$/;

/** Frontmatter keys the strict format accepts — nothing else. */
const ALLOWED_KEYS = ["description", "model", "enabled", "execution"] as const;

/** Strict `execution:` keys (camelCase only; snake_case is an alias → error). */
const ALLOWED_EXECUTION_KEYS = [
  "clarify",
  "maxRuntimeMs",
  "maxTokens",
  "costBudgetUsd",
  "maxQueriesPerRun",
  "thinking",
  "reviewGate",
  "maxReviewLoops",
  "loopPolicy",
] as const;

const ALLOWED_LOOP_POLICY_KEYS = [
  "mode",
  "enabled",
  "maxIterations",
  "maxReviewLoops",
  "reviewGate",
  "externalReviewerPolicy",
  "failBehavior",
  "maxRuntimeMs",
  "maxTokens",
  "costBudgetUsd",
] as const;

/**
 * Execution config as authored in frontmatter — sparse overrides on top of
 * platform defaults. All fields optional; validated strictly.
 */
export interface AgentFolderExecutionInput {
  clarify?: boolean;
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
  maxQueriesPerRun?: number;
  thinking?: string;
  reviewGate?: boolean;
  maxReviewLoops?: number;
  loopPolicy?: Partial<AgentLoopPolicy>;
}

/**
 * Normalized execution state for a folder-format sub-agent. Deliberately
 * carries no depth field — depth is enforced structurally at admission
 * (nested `agents/` folders are rejected), not as a runtime literal.
 */
export interface AgentFolderExecution {
  foreground: true;
  clarify: boolean;
  maxRuntimeMs?: number;
  maxTokens?: number;
  costBudgetUsd?: number;
  maxQueriesPerRun?: number;
  thinking?: string;
  reviewGate?: boolean;
  maxReviewLoops?: number;
  loopPolicy: AgentLoopPolicy;
}

export interface AgentFolderConfig {
  slug: string;
  /** Required; passed verbatim as the delegation tool description (R3). */
  description: string;
  /** Absent = inherit the platform/parent default at compile time. */
  model?: string;
  enabled: boolean;
  execution: AgentFolderExecution;
  /** The prose body of INSTRUCTIONS.md, verbatim (trimmed). */
  instructions: string;
}

export interface AgentFolderInstructionsInput {
  slug: string;
  description: string;
  model?: string;
  enabled?: boolean;
  execution?: AgentFolderExecutionInput;
  instructions: string;
}

export type AgentFolderInstructionsResult =
  | { valid: true; parsed: AgentFolderConfig }
  | { valid: false; errors: CapabilityDefinitionError[] };

export function agentFolderPath(slug: string): string {
  return `agents/${slug}/`;
}

export function agentFolderInstructionsPath(slug: string): string {
  return `agents/${slug}/${AGENT_INSTRUCTIONS_FILE}`;
}

export function agentFolderSlugFromInstructionsPath(
  path: string,
): string | null {
  const slug = path
    .replace(/^\/+/, "")
    .match(AGENT_FOLDER_INSTRUCTIONS_RE)?.[1];
  if (!slug || !CAPABILITY_SLUG_PATTERN.test(slug)) return null;
  return slug;
}

export function isAgentFolderInstructionsPath(path: string): boolean {
  return agentFolderSlugFromInstructionsPath(path) !== null;
}

/**
 * Serialize the single writer's folder form. The body is the instructions
 * verbatim — no synthetic headings, no machine sections.
 */
export function serializeAgentFolderInstructions(
  input: AgentFolderInstructionsInput,
): string {
  const frontmatter: Record<string, unknown> = {
    description: input.description.trim(),
  };
  if (input.model?.trim()) frontmatter.model = input.model.trim();
  if (input.enabled === false) frontmatter.enabled = false;
  if (input.execution && Object.keys(input.execution).length > 0) {
    frontmatter.execution = input.execution;
  }
  const yaml = stringifyYaml(frontmatter, { collectionStyle: "block" }).trim();
  return `---\n${yaml}\n---\n\n${input.instructions.trim()}\n`;
}

export function parseAgentFolderInstructions(
  source: string,
  path: string,
): AgentFolderInstructionsResult {
  const slug = agentFolderSlugFromInstructionsPath(path);
  if (!slug) {
    return {
      valid: false,
      errors: [
        {
          kind: "FieldShape",
          message: `${path} is not an agents/<slug>/INSTRUCTIONS.md path`,
          details: { path },
        },
      ],
    };
  }

  const split = splitFrontmatter(source);
  if (!split) {
    return {
      valid: false,
      errors: [
        {
          kind: "MissingFrontmatter",
          message: `${path} requires YAML frontmatter with a 'description' field`,
          details: { path },
        },
      ],
    };
  }

  let raw: unknown;
  try {
    raw = parseYaml(split.yaml) ?? {};
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "MalformedFrontmatter",
          message: `${path} frontmatter is not valid YAML`,
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
          message: `${path} frontmatter must be a YAML mapping`,
          details: { path, got: describeType(raw) },
        },
      ],
    };
  }

  const record = raw as Record<string, unknown>;
  const errors: CapabilityDefinitionError[] = [];

  for (const key of Object.keys(record)) {
    if ((ALLOWED_KEYS as readonly string[]).includes(key)) continue;
    if (key === "instructions") {
      errors.push({
        kind: "FieldShape",
        message:
          `${path}: 'instructions' is not a frontmatter field — ` +
          `instructions are the prose body of INSTRUCTIONS.md`,
        details: { path, field: key },
      });
      continue;
    }
    errors.push({
      kind: "FieldShape",
      message:
        `${path}: unknown frontmatter key '${key}' — the agent folder ` +
        `format is strict (allowed: ${ALLOWED_KEYS.join(", ")}); legacy ` +
        `aliases and grant lists are not accepted`,
      details: { path, field: key },
    });
  }

  const description = requireDescription(record.description, path, errors);
  const model = optionalTrimmedString(record.model, "model", path, errors);
  let enabled = true;
  if (record.enabled !== undefined) {
    if (typeof record.enabled !== "boolean") {
      errors.push({
        kind: "FieldType",
        message: `${path} field 'enabled' must be boolean`,
        details: { path, field: "enabled", got: describeType(record.enabled) },
      });
    } else {
      enabled = record.enabled;
    }
  }
  const executionInput = validateExecution(record.execution, path, errors);

  if (errors.length > 0 || !description) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    parsed: {
      slug,
      description,
      ...(model ? { model } : {}),
      enabled,
      execution: normalizeAgentFolderExecution(executionInput ?? {}),
      instructions: split.body.trim(),
    },
  };
}

/**
 * Normalize sparse execution overrides into the effective execution state.
 * Inputs reaching this point are strictly validated (camelCase keys only),
 * so the loop-policy normalizer's legacy alias tolerance never engages.
 */
export function normalizeAgentFolderExecution(
  input: AgentFolderExecutionInput,
): AgentFolderExecution {
  const loopPolicy = normalizeAgentLoopPolicy(input);
  return {
    foreground: true,
    clarify: input.clarify ?? false,
    ...(input.maxRuntimeMs !== undefined
      ? { maxRuntimeMs: input.maxRuntimeMs }
      : {}),
    ...(input.maxTokens !== undefined ? { maxTokens: input.maxTokens } : {}),
    ...(input.costBudgetUsd !== undefined
      ? { costBudgetUsd: input.costBudgetUsd }
      : {}),
    ...(input.maxQueriesPerRun !== undefined
      ? { maxQueriesPerRun: input.maxQueriesPerRun }
      : {}),
    ...(input.thinking?.trim() ? { thinking: input.thinking.trim() } : {}),
    ...(loopPolicy.reviewGate ? { reviewGate: true } : {}),
    ...(input.maxReviewLoops !== undefined || loopPolicy.reviewGate
      ? { maxReviewLoops: loopPolicy.maxReviewLoops }
      : {}),
    loopPolicy,
  };
}

/**
 * Apply optional sidecar state on top of a parsed config. A missing
 * sidecar means enabled/operator-authored with no overrides (R7); a
 * present sidecar may disable the agent or override execution via its
 * `policy.execution` block (validated with the same strict rules).
 */
export function applyAgentFolderSidecar(
  config: AgentFolderConfig,
  sidecar: { enabled?: boolean; policy?: Record<string, unknown> } | null,
  path: string,
):
  | { valid: true; parsed: AgentFolderConfig }
  | { valid: false; errors: CapabilityDefinitionError[] } {
  if (!sidecar) return { valid: true, parsed: config };
  const errors: CapabilityDefinitionError[] = [];
  let execution = config.execution;
  const rawExecution = sidecar.policy?.execution;
  if (rawExecution !== undefined) {
    const overrides = validateExecution(rawExecution, path, errors);
    if (overrides) execution = normalizeAgentFolderExecution(overrides);
  }
  if (errors.length > 0) return { valid: false, errors };
  return {
    valid: true,
    parsed: {
      ...config,
      enabled: sidecar.enabled === false ? false : config.enabled,
      execution,
    },
  };
}

function validateExecution(
  raw: unknown,
  path: string,
  errors: CapabilityDefinitionError[],
): AgentFolderExecutionInput | undefined {
  if (raw === undefined || raw === null) return undefined;
  if (typeof raw !== "object" || Array.isArray(raw)) {
    errors.push({
      kind: "FieldType",
      message: `${path} field 'execution' must be a mapping`,
      details: { path, field: "execution", got: describeType(raw) },
    });
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  const out: AgentFolderExecutionInput = {};

  for (const key of Object.keys(record)) {
    if (!(ALLOWED_EXECUTION_KEYS as readonly string[]).includes(key)) {
      errors.push({
        kind: "FieldShape",
        message:
          `${path}: unknown execution key '${key}' ` +
          `(allowed: ${ALLOWED_EXECUTION_KEYS.join(", ")})`,
        details: { path, field: `execution.${key}` },
      });
    }
  }

  assignBoolean(record, "clarify", out, path, errors);
  assignBoolean(record, "reviewGate", out, path, errors);
  assignPositiveInt(record, "maxRuntimeMs", out, path, errors);
  assignPositiveInt(record, "maxTokens", out, path, errors);
  assignPositiveInt(record, "maxQueriesPerRun", out, path, errors);
  assignPositiveInt(record, "maxReviewLoops", out, path, errors);
  assignPositiveNumber(record, "costBudgetUsd", out, path, errors);
  if (record.thinking !== undefined) {
    if (typeof record.thinking !== "string") {
      errors.push({
        kind: "FieldType",
        message: `${path} field 'execution.thinking' must be a string`,
        details: { path, field: "execution.thinking" },
      });
    } else {
      out.thinking = record.thinking;
    }
  }
  if (record.loopPolicy !== undefined) {
    const loop = validateLoopPolicy(record.loopPolicy, path, errors);
    if (loop) out.loopPolicy = loop;
  }
  return out;
}

function validateLoopPolicy(
  raw: unknown,
  path: string,
  errors: CapabilityDefinitionError[],
): Partial<AgentLoopPolicy> | undefined {
  if (typeof raw !== "object" || raw === null || Array.isArray(raw)) {
    errors.push({
      kind: "FieldType",
      message: `${path} field 'execution.loopPolicy' must be a mapping`,
      details: { path, field: "execution.loopPolicy" },
    });
    return undefined;
  }
  const record = raw as Record<string, unknown>;
  for (const key of Object.keys(record)) {
    if (!(ALLOWED_LOOP_POLICY_KEYS as readonly string[]).includes(key)) {
      errors.push({
        kind: "FieldShape",
        message:
          `${path}: unknown loopPolicy key '${key}' ` +
          `(allowed: ${ALLOWED_LOOP_POLICY_KEYS.join(", ")})`,
        details: { path, field: `execution.loopPolicy.${key}` },
      });
    }
  }
  checkEnum(record, "mode", AGENT_LOOP_MODES, path, errors);
  checkEnum(
    record,
    "externalReviewerPolicy",
    EXTERNAL_REVIEWER_POLICIES,
    path,
    errors,
  );
  checkEnum(record, "failBehavior", LOOP_FAIL_BEHAVIORS, path, errors);
  return record as Partial<AgentLoopPolicy>;
}

function checkEnum(
  record: Record<string, unknown>,
  key: string,
  allowed: readonly string[],
  path: string,
  errors: CapabilityDefinitionError[],
): void {
  const value = record[key];
  if (value === undefined) return;
  if (typeof value !== "string" || !allowed.includes(value)) {
    errors.push({
      kind: "FieldShape",
      message:
        `${path} field 'execution.loopPolicy.${key}' must be one of ` +
        `[${allowed.join(", ")}]`,
      details: { path, field: `execution.loopPolicy.${key}`, value },
    });
  }
}

function assignBoolean(
  record: Record<string, unknown>,
  key: "clarify" | "reviewGate",
  out: AgentFolderExecutionInput,
  path: string,
  errors: CapabilityDefinitionError[],
): void {
  const value = record[key];
  if (value === undefined) return;
  if (typeof value !== "boolean") {
    errors.push({
      kind: "FieldType",
      message: `${path} field 'execution.${key}' must be boolean`,
      details: { path, field: `execution.${key}`, got: describeType(value) },
    });
    return;
  }
  out[key] = value;
}

function assignPositiveInt(
  record: Record<string, unknown>,
  key: "maxRuntimeMs" | "maxTokens" | "maxQueriesPerRun" | "maxReviewLoops",
  out: AgentFolderExecutionInput,
  path: string,
  errors: CapabilityDefinitionError[],
): void {
  const value = record[key];
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isSafeInteger(value) || value <= 0) {
    errors.push({
      kind: "FieldShape",
      message: `${path} field 'execution.${key}' must be a positive integer`,
      details: { path, field: `execution.${key}`, value },
    });
    return;
  }
  out[key] = value;
}

function assignPositiveNumber(
  record: Record<string, unknown>,
  key: "costBudgetUsd",
  out: AgentFolderExecutionInput,
  path: string,
  errors: CapabilityDefinitionError[],
): void {
  const value = record[key];
  if (value === undefined) return;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    errors.push({
      kind: "FieldShape",
      message: `${path} field 'execution.${key}' must be a positive number`,
      details: { path, field: `execution.${key}`, value },
    });
    return;
  }
  out[key] = value;
}

function requireDescription(
  raw: unknown,
  path: string,
  errors: CapabilityDefinitionError[],
): string | null {
  if (raw === undefined || raw === null || raw === "") {
    errors.push({
      kind: "MissingField",
      message:
        `${path} requires a non-empty 'description' — it is passed ` +
        `verbatim as the delegation tool description`,
      details: { path, field: "description" },
    });
    return null;
  }
  if (typeof raw !== "string") {
    errors.push({
      kind: "FieldType",
      message: `${path} field 'description' must be a string`,
      details: { path, field: "description", got: describeType(raw) },
    });
    return null;
  }
  const trimmed = raw.trim();
  if (!trimmed) {
    errors.push({
      kind: "MissingField",
      message: `${path} requires a non-empty 'description'`,
      details: { path, field: "description" },
    });
    return null;
  }
  if (trimmed.length > MAX_DESCRIPTION_LEN) {
    errors.push({
      kind: "FieldTooLong",
      message:
        `${path} field 'description' exceeds ${MAX_DESCRIPTION_LEN} ` +
        `characters`,
      details: {
        path,
        field: "description",
        length: trimmed.length,
        max: MAX_DESCRIPTION_LEN,
      },
    });
    return null;
  }
  return trimmed;
}

function optionalTrimmedString(
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
  const trimmed = raw.trim();
  return trimmed || undefined;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
