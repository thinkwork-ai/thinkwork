import { useCallback, useState } from "react";
import { useMutation, type AnyVariables, type TypedDocumentNode } from "urql";
import { toast } from "sonner";
import {
  DisableWorkflowTemplateMutation,
  EnableWorkflowTemplateMutation,
} from "@/lib/graphql-queries";
import { useAssignedComputerSelection } from "@/lib/use-assigned-computer-selection";

// useSkillMutation (the former Customize→Skills tab) was removed in
// Composer plan U3 — skill wiring lives in Settings→Composer now. The
// `disableSkill` GraphQL mutation was retired from the schema in Composer
// plan U8 (no client referenced it).

export interface UseToggleMutationResult {
  toggle: (key: string, nextConnected: boolean) => Promise<void>;
  pendingSlugs: ReadonlySet<string>;
}

const WORKFLOW_TYPENAMES = [
  "Routine",
  "WorkflowTemplateBinding",
  "CustomizeBindings",
] as const;

interface ToggleMutationOptions {
  enableMutation: TypedDocumentNode<unknown, AnyVariables>;
  disableMutation: TypedDocumentNode<unknown, AnyVariables>;
  typenames: readonly string[];
  buildVariables: (agentId: string, key: string) => AnyVariables;
}

// Per-wrapper option bags hoisted to module scope so each wrapper hook
// passes a stable reference into useToggleMutation. Inline object
// literals would invalidate `toggle`'s useCallback deps every render
// and bust referential identity for downstream consumers.
const WORKFLOW_OPTS: ToggleMutationOptions = {
  enableMutation: EnableWorkflowTemplateMutation,
  disableMutation: DisableWorkflowTemplateMutation,
  typenames: WORKFLOW_TYPENAMES,
  buildVariables: (agentId, slug) => ({ input: { agentId, slug } }),
};

/**
 * Shared core for the Customize tab Connect / Disable buttons. Resolves
 * the caller's selected assigned Computer id once and owns the
 * pending-key Set so overlapping toggles don't clobber each other.
 * Server errors surface via `toast.error(message)`.
 *
 * The workflow-template hook is a thin wrapper around this helper.
 * Plan: docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md U6-4.
 */
export function useToggleMutation(
  opts: ToggleMutationOptions,
): UseToggleMutationResult {
  const { selectedComputer } = useAssignedComputerSelection();
  const computerId = selectedComputer?.id ?? null;

  const [, enable] = useMutation(opts.enableMutation);
  const [, disable] = useMutation(opts.disableMutation);
  // Set so overlapping toggles don't clobber each other's pending state.
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  const toggle = useCallback(
    async (key: string, nextConnected: boolean) => {
      if (!computerId) {
        toast.error("Select an assigned workspace before changing Customize.");
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
          toast.error(result.error.message);
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
 * urql wrapper for the Workflow Templates tab Connect / Disable button.
 * Composes useToggleMutation with the workflow-template mutation pair and the
 * `WORKFLOW_TYPENAMES` invalidation set. No special-case error code
 * routing — `CUSTOMIZE_CATALOG_NOT_FOUND` and
 * `CUSTOMIZE_PRIMARY_AGENT_NOT_FOUND` fall through to `toast.error`.
 */
export function useWorkflowMutation(): UseToggleMutationResult {
  return useToggleMutation(WORKFLOW_OPTS);
}
