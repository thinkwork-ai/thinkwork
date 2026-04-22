/**
 * Pure merge logic for `syncTemplateToAgent`.
 *
 * Produces the new `agent_skills` rows for one agent by combining:
 *   - the template's current skills list (desired state),
 *   - the agent's current skills rows (per-agent state, including
 *     operator-authored permissions.operations narrowing),
 *   - the set of skill_ids whose manifest declares
 *     `permissions_model: operations` (the opt-in flag).
 *
 * For `permissions_model: operations` skills the merge applies
 * intersection semantics (Unit 6a, R7):
 *
 *   agent_new.permissions.operations =
 *     agent_current.operations ∩ template_new.operations
 *
 * Inheritance (null permissions) propagates as inheritance. An agent
 * that had narrowed `[me, list_agents]` from a template `[me,
 * list_agents, invite_member]` keeps `[me, list_agents]` across a
 * template shrink to `[me, list_agents]` (no-op), and rebases to
 * `[me]` across a template shrink to `[me]` (drops `list_agents`).
 *
 * Non-opt-in skills (manifest has no `permissions_model` key) retain
 * their existing behavior: the agent's current `permissions` jsonb is
 * preserved if the row exists, otherwise the template's value is
 * copied in as the initial state. This plan explicitly leaves that
 * semantic untouched for skills that don't participate in the model.
 *
 * The function is pure — it reads no DB and performs no I/O — so it
 * can be unit-tested directly without the full resolver test harness.
 */

import { intersectPermissions } from "./permissions-subset.js";

export type TemplateSkillRow = {
  skill_id: string;
  config?: unknown;
  permissions?: unknown;
  rate_limit_rpm?: number | null;
  model_override?: string | null;
  enabled?: boolean;
};

export type CurrentAgentSkillRow = {
  permissions?: unknown;
};

export type MergedSkillRow = {
  skill_id: string;
  config: unknown;
  permissions: unknown;
  rate_limit_rpm: number | null;
  model_override: string | null;
  enabled: boolean;
};

export function mergeTemplateSkillsIntoAgent({
  templateSkills,
  currentBySkillId,
  permissionsModelOptIns,
}: {
  templateSkills: readonly TemplateSkillRow[];
  currentBySkillId: Map<string, CurrentAgentSkillRow>;
  permissionsModelOptIns: Set<string>;
}): MergedSkillRow[] {
  const merged: MergedSkillRow[] = [];
  for (const t of templateSkills) {
    if (!t || typeof t.skill_id !== "string") continue;
    const cur = currentBySkillId.get(t.skill_id);
    const isOptIn = permissionsModelOptIns.has(t.skill_id);

    let permissions: unknown;
    if (isOptIn) {
      const curOps = readExplicitOperations(cur?.permissions);
      const tplOps = readExplicitOperations(t.permissions);
      if (curOps === null) {
        // Agent was inheriting — stay inheriting regardless of whether
        // the template has explicit ops. UI renders full template list.
        permissions = null;
      } else if (tplOps === null) {
        // Template has no authored permissions but the agent has an
        // explicit override. Intersection with an empty ceiling is [].
        // The R12 empty-allowlist warning surfaces in the UI.
        permissions = { operations: [] };
      } else {
        permissions = { operations: intersectPermissions(curOps, tplOps) };
      }
    } else {
      // Non-opt-in skill: preserve agent's current permissions if the
      // row exists; otherwise seed from the template's value.
      permissions = cur?.permissions ?? t.permissions ?? null;
    }

    merged.push({
      skill_id: t.skill_id,
      config: t.config ?? null,
      permissions,
      rate_limit_rpm: t.rate_limit_rpm ?? null,
      model_override: t.model_override ?? null,
      enabled: t.enabled ?? true,
    });
  }
  return merged;
}

/**
 * Returns the permissions.operations array if the jsonb is an explicit
 * `{operations: [...]}` object, or null when the caller is inheriting
 * (null/undefined/missing-key). Tolerates AWSJSON-style stringified
 * payloads.
 */
export function readExplicitOperations(raw: unknown): string[] | null {
  if (raw === null || raw === undefined) return null;
  const value = typeof raw === "string" ? safeJsonParse(raw) : raw;
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const ops = (value as Record<string, unknown>).operations;
  if (ops === null || ops === undefined) return null;
  if (!Array.isArray(ops)) return null;
  const out: string[] = [];
  for (const op of ops) if (typeof op === "string") out.push(op);
  return out;
}

function safeJsonParse(s: string): unknown {
  try {
    return JSON.parse(s);
  } catch {
    return null;
  }
}
