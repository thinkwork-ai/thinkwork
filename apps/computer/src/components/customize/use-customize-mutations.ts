import { useCallback, useState } from "react";
import { useMutation, useQuery, type AnyVariables, type TypedDocumentNode } from "urql";
import { toast } from "sonner";
import {
  DisableSkillMutation,
  DisableWorkflowMutation,
  EnableSkillMutation,
  EnableWorkflowMutation,
  MyComputerQuery,
} from "@/lib/graphql-queries";

interface MyComputerResult {
  myComputer?: { id: string } | null;
}

export interface UseToggleMutationResult {
  toggle: (key: string, nextConnected: boolean) => Promise<void>;
  pendingSlugs: ReadonlySet<string>;
}

const SKILL_TYPENAMES = ["AgentSkill", "CustomizeBindings"] as const;

const WORKFLOW_TYPENAMES = [
  "Routine",
  "WorkflowBinding",
  "CustomizeBindings",
] as const;

/** Surfaced when the server rejects a built-in tool slug toggle. */
export const BUILTIN_TOOL_HINT =
  "Built-in skills are managed by your tenant template, not the Customize page.";

interface ToggleMutationOptions {
  enableMutation: TypedDocumentNode<unknown, AnyVariables>;
  disableMutation: TypedDocumentNode<unknown, AnyVariables>;
  typenames: readonly string[];
  buildVariables: (
    computerId: string,
    key: string,
  ) => AnyVariables;
  /** Map a server `extensions.code` to a sonner `toast.message` hint. */
  errorCodeHints?: Readonly<Record<string, string>>;
}

// Per-wrapper option bags hoisted to module scope so each wrapper hook
// passes a stable reference into useToggleMutation. Inline object
// literals would invalidate `toggle`'s useCallback deps every render
// and bust referential identity for downstream consumers.
const SKILL_OPTS: ToggleMutationOptions = {
  enableMutation: EnableSkillMutation,
  disableMutation: DisableSkillMutation,
  typenames: SKILL_TYPENAMES,
  buildVariables: (computerId, skillId) => ({
    input: { computerId, skillId },
  }),
  errorCodeHints: {
    CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE: BUILTIN_TOOL_HINT,
  },
};

const WORKFLOW_OPTS: ToggleMutationOptions = {
  enableMutation: EnableWorkflowMutation,
  disableMutation: DisableWorkflowMutation,
  typenames: WORKFLOW_TYPENAMES,
  buildVariables: (computerId, slug) => ({ input: { computerId, slug } }),
};

/**
 * Shared core for the Customize tab Connect / Disable buttons. Resolves
 * the caller's Computer id once via MyComputerQuery, owns the
 * pending-key Set so overlapping toggles don't clobber, and routes
 * server `extensions.code` errors to per-mutation hint messages when
 * present (otherwise falls back to `toast.error(message)`).
 *
 * The skill / workflow hooks are thin wrappers around this helper.
 * Plan: docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md U6-4.
 */
export function useToggleMutation(
  opts: ToggleMutationOptions,
): UseToggleMutationResult {
  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computerId = computerData?.myComputer?.id ?? null;

  const [, enable] = useMutation(opts.enableMutation);
  const [, disable] = useMutation(opts.disableMutation);
  // Set so overlapping toggles don't clobber each other's pending state.
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  const toggle = useCallback(
    async (key: string, nextConnected: boolean) => {
      if (!computerId) {
        toast.error("Couldn't resolve your Computer — please reload.");
        return;
      }
      setPendingSlugs((prev) => {
        const next = new Set(prev);
        next.add(key);
        return next;
      });
      try {
        const variables = opts.buildVariables(computerId, key);
        const additionalTypenames = [...opts.typenames];
        const result = nextConnected
          ? await enable(variables, { additionalTypenames })
          : await disable(variables, { additionalTypenames });
        if (result.error) {
          const codeRaw =
            result.error.graphQLErrors[0]?.extensions?.code;
          const code =
            typeof codeRaw === "string" ? codeRaw : undefined;
          const hint = code ? opts.errorCodeHints?.[code] : undefined;
          if (hint) {
            toast.message(hint);
          } else {
            toast.error(result.error.message);
          }
        }
      } finally {
        setPendingSlugs((prev) => {
          if (!prev.has(key)) return prev;
          const next = new Set(prev);
          next.delete(key);
          return next;
        });
      }
    },
    [computerId, enable, disable, opts],
  );

  return { toggle, pendingSlugs };
}

/**
 * urql wrapper for the Skills-tab Connect / Disable button. Composes
 * useToggleMutation with the skill mutation pair, the `SKILL_TYPENAMES`
 * invalidation set, and routes `CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE`
 * to BUILTIN_TOOL_HINT.
 */
export function useSkillMutation(): UseToggleMutationResult {
  return useToggleMutation(SKILL_OPTS);
}

/**
 * urql wrapper for the Workflows-tab Connect / Disable button. Composes
 * useToggleMutation with the workflow mutation pair and the
 * `WORKFLOW_TYPENAMES` invalidation set. No special-case error code
 * routing — `CUSTOMIZE_CATALOG_NOT_FOUND` and
 * `CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND` fall through to `toast.error`.
 */
export function useWorkflowMutation(): UseToggleMutationResult {
  return useToggleMutation(WORKFLOW_OPTS);
}
