/**
 * SKILL.md parser — splits a Claude-format skill document into its YAML
 * frontmatter and prose body, then validates the frontmatter against the
 * plan's V1 acceptance rules.
 *
 * The shape we expect (matches Anthropic's Agent Skills spec):
 *
 *   ---
 *   name: sales-prep
 *   description: Short, skimmable — what the model sees at Level-1 disclosure.
 *   allowed-tools: [Read, Grep, Skill]   # optional, informational
 *   ---
 *
 *   # Prose body the model reads inline when scripts/ is absent, or that
 *   # documents the skill for humans when scripts/ runs it.
 *
 * Validation rules (plan #007 §U9 Approach):
 *   - `name` required. Must match [a-z0-9-]+, length ≤ 64, must not contain
 *     "anthropic" or "claude" (Anthropic's spec reserves those substrings).
 *   - `description` required. Length ≤ 1024. Free-form prose.
 *   - `allowed-tools` optional. Captured informationally — the harness's
 *     intersect-narrow at registration (plan §Key Technical Decisions)
 *     enforces the actual gate.
 *   - Frontmatter block required (strict mode). A SKILL.md without
 *     frontmatter is treated as malformed — this is how the parser tells
 *     a plugin bundle's intent-bearing file from a stray README. The
 *     lenient parser (`parseSkillMdInternal`) tolerates missing
 *     frontmatter for the thinkwork-internal catalog loaders that
 *     migrate skills off `skill.yaml` onto SKILL.md frontmatter (plan
 *     2026-04-24-009 §U1).
 *
 * The parser is defensive against every YAML-nasty I could anticipate:
 * aliases, anchors, custom tags, non-string values where strings are
 * required. `yaml`'s default load options already reject the wildest
 * shapes, but we re-check types explicitly rather than trusting inferred
 * unknowns.
 *
 * Internal field union (plan 2026-04-24-009 §U1):
 *   The thinkwork-internal catalog (skill-catalog/<slug>/SKILL.md) uses
 *   the same frontmatter block to carry the fields that previously lived
 *   in `skill.yaml` — `execution`, `mode`, `scripts`, `inputs`,
 *   `triggers`, `tenant_overridable`, `requires_skills`,
 *   `permissions_model`, plus catalog metadata (`category`, `icon`,
 *   `tags`, `requires_env`, `oauth_provider`, `oauth_scopes`,
 *   `mcp_server`, `mcp_tools`, `dependencies`, `is_default`,
 *   `compatibility`). The parser preserves these verbatim on
 *   `parsed.internal` and validates the one tripwire field we cannot
 *   tolerate drifting on: `execution`. Anything else passes through
 *   un-typed for downstream callers to coerce.
 */

import { parse as parseYaml } from "yaml";

export const MAX_NAME_LEN = 64;
export const MAX_DESCRIPTION_LEN = 1024;
export const NAME_PATTERN = /^[a-z0-9-]+$/;
// Reserved by Anthropic's Agent Skills spec — skill authors MUST NOT ship
// a name that collides with the vendor. Case-insensitive substring match
// so no creative capitalisation slips through.
const RESERVED_NAME_SUBSTRINGS = ["anthropic", "claude"];
// U6 retired composition skills — every skill is now either `script` or
// `context`. Empty/missing defaults to `context`. Anything else (notably
// the legacy `composition`) is the audit drift we're trying to catch.
export const ALLOWED_EXECUTION_VALUES = ["script", "context"] as const;
export type SkillExecution = (typeof ALLOWED_EXECUTION_VALUES)[number];

export type SkillMdErrorKind =
  | "SkillMdMissingFrontmatter"
  | "SkillMdMalformedFrontmatter"
  | "SkillMdMissingField"
  | "SkillMdFieldType"
  | "SkillMdFieldTooLong"
  | "SkillMdFieldShape"
  | "SkillMdNameReserved"
  | "SkillMdUnsupportedExecution";

export interface SkillMdError {
  kind: SkillMdErrorKind;
  message: string;
  details: { path: string; field?: string; [k: string]: unknown };
}

export interface SkillMdParsed {
  /** Path within the zip (e.g. `skills/sales-prep/SKILL.md`). */
  path: string;
  name: string;
  description: string;
  /**
   * Advisory — captures the frontmatter's `allowed-tools` so the
   * operator can review what the skill *says* it needs. The runtime
   * enforces the real allowlist at session construction; see
   * `skill_meta_tool.intersect_allowed_tools`.
   */
  allowedToolsDeclared: string[];
  /** Prose body (everything after the second `---` line). */
  body: string;
  /**
   * Resolved execution mode. `null` when the frontmatter doesn't
   * declare one — callers default to `"context"`. `"composition"` is
   * rejected at parse time so an audit drift surfaces here, not in a
   * downstream caller.
   *
   * Optional in the type so legacy test fixtures that pre-date the U1
   * extension continue to compile. The real `parseSkillMd` always
   * populates this field (use `null` for "absent in frontmatter").
   */
  execution?: SkillExecution | null;
  /**
   * Raw frontmatter mapping with `name`/`description`/`allowed-tools`
   * stripped. Carries every thinkwork-internal field the parser
   * preserves verbatim — `mode`, `scripts`, `inputs`, `triggers`,
   * `tenant_overridable`, `requires_skills`, `permissions_model`,
   * `category`, `icon`, `tags`, `requires_env`, `oauth_provider`,
   * `oauth_scopes`, `mcp_server`, `mcp_tools`, `dependencies`,
   * `is_default`, `compatibility`, `version`, `license`, `metadata`,
   * `display_name`, `model`, plus anything else the author put on the
   * frontmatter. Downstream callers coerce/validate as needed.
   *
   * Optional for the same legacy-fixture reason as `execution`.
   */
  internal?: Record<string, unknown>;
}

/**
 * Lenient parser result — `frontmatterPresent` lets a caller distinguish
 * "no frontmatter at all" (empty dict, no error) from "frontmatter
 * present and parsed". Both still surface execution rejection.
 */
export interface SkillMdInternalParsed {
  path: string;
  /** True when the file had a `---` frontmatter block. */
  frontmatterPresent: boolean;
  /**
   * Raw mapping (full frontmatter including name/description). Empty
   * when no frontmatter is present.
   */
  data: Record<string, unknown>;
  /** Prose body. The whole source when no frontmatter is present. */
  body: string;
  /**
   * Resolved execution mode. `null` for missing/empty values — caller
   * defaults to `"context"`.
   */
  execution: SkillExecution | null;
}

export type SkillMdResult =
  | { valid: true; parsed: SkillMdParsed }
  | { valid: false; errors: SkillMdError[] };

export type SkillMdInternalResult =
  | { valid: true; parsed: SkillMdInternalParsed }
  | { valid: false; errors: SkillMdError[] };

/**
 * Split a SKILL.md source into its frontmatter YAML and body prose.
 *
 * Returns `null` when the document does not carry a frontmatter block,
 * which lets callers emit a specific "missing frontmatter" error instead
 * of a generic malformed-YAML one.
 */
export function splitFrontmatter(
  source: string,
): { yaml: string; body: string } | null {
  // The opening `---` must be the very first line. A BOM is tolerated —
  // some editors save with one — but anything else before the marker
  // means the document isn't a frontmatter document.
  const trimmed = source.replace(/^﻿/, "");
  if (!trimmed.startsWith("---")) return null;

  // Locate the closing `---` on its own line. A stray `---` mid-prose
  // would confuse us; we require the marker to start at column 0 and
  // be followed by a newline or EOF.
  const openingNewline = trimmed.indexOf("\n");
  if (openingNewline === -1) return null;

  // Everything after the opening marker is either the YAML body until
  // the closing marker, or prose if the closing marker is absent.
  const rest = trimmed.slice(openingNewline + 1);
  const closing = rest.search(/(^|\n)---[\r\n]/);
  if (closing === -1) return null;

  const yamlText =
    closing === 0 ? "" : rest.slice(0, closing).replace(/\n$/, "");
  // Skip past the closing `---` and its trailing newline(s).
  const afterClose = rest.slice(closing).replace(/^\n?---[\r\n]+/, "");
  return { yaml: yamlText, body: afterClose };
}

/**
 * Parse + validate a SKILL.md document. `path` is the entry's path inside
 * the zip — threaded through for error messages so operators can find
 * the offending file by path rather than by guesswork.
 */
export function parseSkillMd(source: string, path: string): SkillMdResult {
  const split = splitFrontmatter(source);
  if (split === null) {
    return {
      valid: false,
      errors: [
        {
          kind: "SkillMdMissingFrontmatter",
          message: `SKILL.md at ${path} has no '---' frontmatter block`,
          details: { path },
        },
      ],
    };
  }

  let fm: unknown;
  try {
    // `yaml`'s default options already reject aliases, anchors, and
    // custom tags. We still handle parse errors explicitly so the
    // operator sees a line number rather than a stack trace.
    fm = parseYaml(split.yaml);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "SkillMdMalformedFrontmatter",
          message: `SKILL.md at ${path} has malformed YAML frontmatter`,
          details: { path, cause: (e as Error).message },
        },
      ],
    };
  }

  if (fm === null || typeof fm !== "object" || Array.isArray(fm)) {
    return {
      valid: false,
      errors: [
        {
          kind: "SkillMdMalformedFrontmatter",
          message: `SKILL.md at ${path} frontmatter is not a mapping`,
          details: { path, got: describeType(fm) },
        },
      ],
    };
  }

  const record = fm as Record<string, unknown>;
  const errors: SkillMdError[] = [];

  const name = validateName(record.name, path, errors);
  const description = validateDescription(record.description, path, errors);
  const allowedToolsDeclared = validateAllowedTools(
    record["allowed-tools"],
    path,
    errors,
  );
  const execution = validateExecution(record.execution, path, errors);

  if (errors.length > 0 || name === null || description === null) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    parsed: {
      path,
      name,
      description,
      allowedToolsDeclared,
      body: split.body,
      execution,
      internal: extractInternal(record),
    },
  };
}

/**
 * Lenient counterpart to `parseSkillMd` for thinkwork-internal callers
 * (catalog loaders, agentcore-strands skill registration). Tolerates
 * SKILL.md files with no frontmatter (returns `data: {}`,
 * `frontmatterPresent: false`) but still rejects malformed YAML and
 * `execution: composition`. Does NOT enforce `name`/`description` —
 * those checks belong to the SI-4 plugin upload boundary, not to the
 * thinkwork-shipped catalog where authors may iterate freely on
 * frontmatter completeness.
 *
 * The `path` argument doubles as the source identifier in error
 * messages — pass the on-disk filepath, the S3 key, or the zip-relative
 * path as the situation demands.
 */
export function parseSkillMdInternal(
  source: string,
  path: string,
): SkillMdInternalResult {
  const split = splitFrontmatter(source);
  if (split === null) {
    // Lenient mode — a SKILL.md with no frontmatter is treated as a
    // body-only document. Callers that need a name/description ask for
    // it from `data` and decide whether absence is fatal in their own
    // domain (e.g. dispatcher index needs `name`, plain prose body
    // doesn't).
    return {
      valid: true,
      parsed: {
        path,
        frontmatterPresent: false,
        data: {},
        body: source,
        execution: null,
      },
    };
  }

  let fm: unknown;
  try {
    fm = parseYaml(split.yaml);
  } catch (e) {
    return {
      valid: false,
      errors: [
        {
          kind: "SkillMdMalformedFrontmatter",
          message: `SKILL.md at ${path} has malformed YAML frontmatter`,
          details: { path, cause: (e as Error).message },
        },
      ],
    };
  }

  // An empty frontmatter (`---\n---`) yields `null`, which we treat as
  // "frontmatter present but empty" — distinguishable from "no
  // frontmatter at all" via `frontmatterPresent: true`.
  if (fm === null) {
    return {
      valid: true,
      parsed: {
        path,
        frontmatterPresent: true,
        data: {},
        body: split.body,
        execution: null,
      },
    };
  }

  if (typeof fm !== "object" || Array.isArray(fm)) {
    return {
      valid: false,
      errors: [
        {
          kind: "SkillMdMalformedFrontmatter",
          message: `SKILL.md at ${path} frontmatter is not a mapping`,
          details: { path, got: describeType(fm) },
        },
      ],
    };
  }

  const record = fm as Record<string, unknown>;
  const errors: SkillMdError[] = [];
  const execution = validateExecution(record.execution, path, errors);

  if (errors.length > 0) {
    return { valid: false, errors };
  }

  return {
    valid: true,
    parsed: {
      path,
      frontmatterPresent: true,
      data: record,
      body: split.body,
      execution,
    },
  };
}

function validateName(
  raw: unknown,
  path: string,
  errors: SkillMdError[],
): string | null {
  if (raw === undefined || raw === null || raw === "") {
    errors.push({
      kind: "SkillMdMissingField",
      message: `SKILL.md at ${path} is missing required field 'name'`,
      details: { path, field: "name" },
    });
    return null;
  }
  if (typeof raw !== "string") {
    errors.push({
      kind: "SkillMdFieldType",
      message: `SKILL.md at ${path} field 'name' must be a string, got ${describeType(raw)}`,
      details: { path, field: "name", got: describeType(raw) },
    });
    return null;
  }
  if (raw.length > MAX_NAME_LEN) {
    errors.push({
      kind: "SkillMdFieldTooLong",
      message: `SKILL.md at ${path} field 'name' is ${raw.length} chars (max ${MAX_NAME_LEN})`,
      details: { path, field: "name", length: raw.length, max: MAX_NAME_LEN },
    });
    return null;
  }
  if (!NAME_PATTERN.test(raw)) {
    errors.push({
      kind: "SkillMdFieldShape",
      message:
        `SKILL.md at ${path} field 'name' must match ${NAME_PATTERN.source} ` +
        `(got "${raw}")`,
      details: {
        path,
        field: "name",
        value: raw,
        pattern: NAME_PATTERN.source,
      },
    });
    return null;
  }
  const lower = raw.toLowerCase();
  for (const reserved of RESERVED_NAME_SUBSTRINGS) {
    if (lower.includes(reserved)) {
      errors.push({
        kind: "SkillMdNameReserved",
        message:
          `SKILL.md at ${path} field 'name' contains reserved substring "${reserved}" ` +
          `(got "${raw}")`,
        details: { path, field: "name", value: raw, reserved },
      });
      return null;
    }
  }
  return raw;
}

function validateDescription(
  raw: unknown,
  path: string,
  errors: SkillMdError[],
): string | null {
  if (raw === undefined || raw === null || raw === "") {
    errors.push({
      kind: "SkillMdMissingField",
      message: `SKILL.md at ${path} is missing required field 'description'`,
      details: { path, field: "description" },
    });
    return null;
  }
  if (typeof raw !== "string") {
    errors.push({
      kind: "SkillMdFieldType",
      message: `SKILL.md at ${path} field 'description' must be a string, got ${describeType(raw)}`,
      details: { path, field: "description", got: describeType(raw) },
    });
    return null;
  }
  if (raw.length > MAX_DESCRIPTION_LEN) {
    errors.push({
      kind: "SkillMdFieldTooLong",
      message:
        `SKILL.md at ${path} field 'description' is ${raw.length} chars ` +
        `(max ${MAX_DESCRIPTION_LEN})`,
      details: {
        path,
        field: "description",
        length: raw.length,
        max: MAX_DESCRIPTION_LEN,
      },
    });
    return null;
  }
  return raw;
}

function validateAllowedTools(
  raw: unknown,
  path: string,
  errors: SkillMdError[],
): string[] {
  if (raw === undefined || raw === null) return [];
  if (!Array.isArray(raw)) {
    errors.push({
      kind: "SkillMdFieldType",
      message:
        `SKILL.md at ${path} field 'allowed-tools' must be a list of strings, ` +
        `got ${describeType(raw)}`,
      details: { path, field: "allowed-tools", got: describeType(raw) },
    });
    return [];
  }
  const tools: string[] = [];
  for (const item of raw) {
    if (typeof item !== "string") {
      errors.push({
        kind: "SkillMdFieldType",
        message:
          `SKILL.md at ${path} field 'allowed-tools' contains non-string item ` +
          `(${describeType(item)})`,
        details: { path, field: "allowed-tools", got: describeType(item) },
      });
      return [];
    }
    tools.push(item);
  }
  return tools;
}

function validateExecution(
  raw: unknown,
  path: string,
  errors: SkillMdError[],
): SkillExecution | null {
  // Missing / explicit-null / empty-string all mean "default to context".
  // The skill-registration loader applies the default; the parser just
  // signals absence here.
  if (raw === undefined || raw === null || raw === "") return null;
  if (typeof raw !== "string") {
    errors.push({
      kind: "SkillMdFieldType",
      message: `SKILL.md at ${path} field 'execution' must be a string, got ${describeType(raw)}`,
      details: { path, field: "execution", got: describeType(raw) },
    });
    return null;
  }
  if (
    !(ALLOWED_EXECUTION_VALUES as readonly string[]).includes(raw)
  ) {
    errors.push({
      kind: "SkillMdUnsupportedExecution",
      message:
        `SKILL.md at ${path} field 'execution' must be one of ` +
        `[${ALLOWED_EXECUTION_VALUES.join(", ")}] (got "${raw}"); ` +
        `'composition' was retired in U6 of plan 2026-04-22-005`,
      details: {
        path,
        field: "execution",
        value: raw,
        allowed: ALLOWED_EXECUTION_VALUES,
      },
    });
    return null;
  }
  return raw as SkillExecution;
}

/**
 * Strip the SI-4 surface fields (`name`, `description`,
 * `allowed-tools`) from the raw frontmatter mapping. Everything else —
 * thinkwork-internal behavioral fields, catalog metadata, and any
 * unknown-but-tolerated keys — is preserved verbatim for downstream
 * callers.
 */
function extractInternal(record: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(record)) {
    if (k === "name" || k === "description" || k === "allowed-tools") continue;
    out[k] = v;
  }
  return out;
}

function describeType(value: unknown): string {
  if (value === null) return "null";
  if (Array.isArray(value)) return "array";
  return typeof value;
}
