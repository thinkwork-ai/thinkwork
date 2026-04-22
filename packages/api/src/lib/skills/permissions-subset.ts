/**
 * Validator + pure functions for agent_skills.permissions.operations.
 *
 * Enforces the invariant from
 * `docs/plans/2026-04-22-008-feat-agent-skill-permissions-ui-plan.md`:
 *
 *   agent.ops ⊆ template.ops ⊆ manifest.ops
 *
 * Called from the `setAgentSkills` resolver at write time — once per
 * incoming skill entry whose manifest declares
 * `permissions_model: operations`. A non-UI caller (CLI, direct
 * GraphQL, the thinkwork-admin skill's own `set_agent_skills` wrapper)
 * cannot widen an agent above its template's ceiling because this
 * validator runs at the resolver boundary, not only in the UI.
 *
 * Write-boundary invariant: the only permitted writers of
 * `agent_skills.permissions.operations` are:
 *   1. `setAgentSkills` (this validation path)
 *   2. `syncTemplateToAgent` via `intersectPermissions` (which is a
 *      subset by construction)
 * Any future writer must go through one of these paths.
 *
 * Shape mirrors `validateTemplateSandbox` at
 * `packages/api/src/lib/templates/sandbox-config.ts` — returns a
 * discriminated union so the resolver can surface the error string
 * verbatim as `BAD_USER_INPUT`.
 */

/**
 * Normalized view of a parsed `permissions` jsonb payload. Internal
 * to this module; callers work with the public functions below.
 */
type ParsedPermissions =
  | { kind: "inherit" } // null, undefined, or missing `operations` key
  | { kind: "explicit"; operations: string[] }
  | { kind: "invalid"; error: string };

const SAFE_PARSE_FAIL = Symbol("safeParseFail");

function safeParse(s: string): unknown | typeof SAFE_PARSE_FAIL {
  try {
    return JSON.parse(s);
  } catch {
    return SAFE_PARSE_FAIL;
  }
}

function parsePermissions(raw: unknown): ParsedPermissions {
  if (raw === null || raw === undefined) {
    return { kind: "inherit" };
  }

  // Accept AWSJSON-style stringified JSON as well as a parsed object. The
  // GraphQL layer sometimes hands through strings depending on whether the
  // caller pre-parsed or not.
  const value = typeof raw === "string" ? safeParse(raw) : raw;
  if (value === SAFE_PARSE_FAIL) {
    return { kind: "invalid", error: "permissions: invalid JSON payload" };
  }
  if (value === null) {
    return { kind: "inherit" };
  }
  if (typeof value !== "object" || Array.isArray(value)) {
    return {
      kind: "invalid",
      error: "permissions: must be an object with `operations`",
    };
  }

  const v = value as Record<string, unknown>;
  if (!("operations" in v) || v.operations === null || v.operations === undefined) {
    return { kind: "inherit" };
  }
  if (!Array.isArray(v.operations)) {
    return {
      kind: "invalid",
      error: "permissions.operations: must be an array of op names",
    };
  }
  const ops: string[] = [];
  for (const op of v.operations) {
    if (typeof op !== "string") {
      return {
        kind: "invalid",
        error: "permissions.operations: all entries must be strings",
      };
    }
    ops.push(op);
  }
  return { kind: "explicit", operations: ops };
}

export type PermissionsValidationResult =
  | { ok: true }
  | { ok: false; error: string };

/**
 * Enforces `agent.ops ⊆ template.ops ⊆ manifest.ops` at resolver
 * write-time. All three arguments may be null/undefined:
 *
 *   - `agentPerms` null/undefined ⇒ inheriting, always valid.
 *   - `agentPerms.operations = []` ⇒ explicit narrowed-to-empty, valid.
 *   - `templatePerms` null/undefined ⇒ template has no authored permissions
 *     for this skill. An explicit agent override is rejected because
 *     there is no ceiling to narrow from.
 *   - `manifestOps` enforces the closed-universe: ops the agent tries to
 *     grant must also be in the manifest. This catches typos that slipped
 *     past the UI and fabricated op names an adversarial caller might
 *     write through a direct GraphQL mutation.
 *
 * Error messages name the offending op so the admin SPA surfaces a
 * useful toast ("op 'foo' not authorized by template") rather than a
 * generic FORBIDDEN.
 */
export function validateAgentSkillPermissions(
  agentPerms: unknown,
  templatePerms: unknown,
  manifestOps: readonly string[],
): PermissionsValidationResult {
  const agent = parsePermissions(agentPerms);
  if (agent.kind === "invalid") return { ok: false, error: agent.error };
  if (agent.kind === "inherit") return { ok: true };

  const template = parsePermissions(templatePerms);
  if (template.kind === "invalid")
    return {
      ok: false,
      error: `template permissions: ${template.error.replace(/^permissions/, "")}`.replace(
        /^template permissions: : /,
        "template permissions: ",
      ),
    };
  if (template.kind === "inherit") {
    return {
      ok: false,
      error:
        "template has no permissions authored for this skill; cannot set agent-level override",
    };
  }

  const manifestSet = new Set(manifestOps);
  const templateSet = new Set(template.operations);

  for (const op of agent.operations) {
    if (!manifestSet.has(op)) {
      return {
        ok: false,
        error: `op '${op}' is not declared in the skill manifest`,
      };
    }
    if (!templateSet.has(op)) {
      return {
        ok: false,
        error: `op '${op}' is not authorized by template`,
      };
    }
  }
  return { ok: true };
}

/**
 * Pure set intersection preserving the order of `agentOps`.
 *
 * Used by `syncTemplateToAgent` (Unit 6a) to compute
 * `agent_new.ops = agent_current.ops ∩ template_new.ops`, which:
 *
 *   - preserves agent narrowing within the new template ceiling
 *     (ops the agent had that are still in the template stay),
 *   - rebases the agent when the template shrinks (ops the agent had
 *     that are no longer in the template drop).
 *
 * Agent rows with null/inheriting permissions should not be passed
 * here — the caller handles the inheritance case by leaving the agent
 * row's `permissions` column null.
 */
export function intersectPermissions(
  agentOps: readonly string[],
  templateOps: readonly string[],
): string[] {
  const templateSet = new Set(templateOps);
  const out: string[] = [];
  const seen = new Set<string>();
  for (const op of agentOps) {
    if (!templateSet.has(op)) continue;
    if (seen.has(op)) continue; // deduplicate while preserving order
    seen.add(op);
    out.push(op);
  }
  return out;
}
