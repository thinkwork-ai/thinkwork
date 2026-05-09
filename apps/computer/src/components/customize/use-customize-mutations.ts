import { useCallback, useState } from "react";
import { useMutation, useQuery, type AnyVariables, type TypedDocumentNode } from "urql";
import { toast } from "sonner";
import {
  DisableConnectorMutation,
  DisableSkillMutation,
  DisableWorkflowMutation,
  EnableConnectorMutation,
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

/** Back-compat aliases retained from U4 / U5 wiring. */
export type UseConnectorMutationResult = UseToggleMutationResult;

const CONNECTOR_TYPENAMES = [
  "Connector",
  "ConnectorBinding",
  "CustomizeBindings",
] as const;

const SKILL_TYPENAMES = ["AgentSkill", "CustomizeBindings"] as const;

const WORKFLOW_TYPENAMES = [
  "Routine",
  "WorkflowBinding",
  "CustomizeBindings",
] as const;

/** Surfaced when a user clicks Connect on an MCP-kind card. */
export const MCP_VIA_MOBILE_HINT =
  "Connect this MCP server from the mobile app's per-user OAuth flow.";

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
const CONNECTOR_OPTS: ToggleMutationOptions = {
  enableMutation: EnableConnectorMutation,
  disableMutation: DisableConnectorMutation,
  typenames: CONNECTOR_TYPENAMES,
  buildVariables: (computerId, slug) => ({ input: { computerId, slug } }),
  errorCodeHints: {
    CUSTOMIZE_MCP_NOT_SUPPORTED: MCP_VIA_MOBILE_HINT,
  },
};

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
 * The connector / skill / workflow hooks are now thin wrappers around
 * this helper. Plan: docs/plans/2026-05-09-010-feat-customize-workflows-live-plan.md U6-4.
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
 * urql wrapper for the Connectors-tab Connect / Disable button. Composes
 * useToggleMutation with the connector mutation pair, the
 * `CONNECTOR_TYPENAMES` invalidation set, and routes
 * `CUSTOMIZE_MCP_NOT_SUPPORTED` to MCP_VIA_MOBILE_HINT.
 *
 * MCP-kind catalog rows must NOT be passed to this hook; the per-tab
 * page short-circuits to MCP_VIA_MOBILE_HINT instead.
 */
export function useConnectorMutation(): UseConnectorMutationResult {
  return useToggleMutation(CONNECTOR_OPTS);
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
