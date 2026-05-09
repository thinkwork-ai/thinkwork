import { useCallback, useState } from "react";
import { useMutation, useQuery } from "urql";
import { toast } from "sonner";
import {
  DisableConnectorMutation,
  DisableSkillMutation,
  EnableConnectorMutation,
  EnableSkillMutation,
  MyComputerQuery,
} from "@/lib/graphql-queries";

interface MyComputerResult {
  myComputer?: { id: string } | null;
}

export interface UseToggleMutationResult {
  toggle: (slug: string, nextConnected: boolean) => Promise<void>;
  pendingSlugs: ReadonlySet<string>;
}

/** Back-compat alias retained from U4 wiring. */
export type UseConnectorMutationResult = UseToggleMutationResult;

const CONNECTOR_TYPENAMES = [
  "Connector",
  "ConnectorBinding",
  "CustomizeBindings",
] as const;

const SKILL_TYPENAMES = ["AgentSkill", "CustomizeBindings"] as const;

/** Surfaced when a user clicks Connect on an MCP-kind card. */
export const MCP_VIA_MOBILE_HINT =
  "Connect this MCP server from the mobile app's per-user OAuth flow.";

/** Surfaced when the server rejects a built-in tool slug toggle. */
export const BUILTIN_TOOL_HINT =
  "Built-in skills are managed by your tenant template, not the Customize page.";

/**
 * urql wrapper for the Connectors-tab Connect / Disable button. Resolves
 * the caller's Computer id once via MyComputerQuery, then routes the
 * Sheet's `(slug, nextConnected)` action to enableConnector or
 * disableConnector. Cache invalidation rides on the mutation's
 * `additionalTypenames` so the catalog + bindings queries refetch
 * automatically — no manual setState in the page.
 *
 * MCP-kind catalog rows must NOT be passed to this hook; the per-tab
 * page short-circuits to MCP_VIA_MOBILE_HINT instead.
 */
export function useConnectorMutation(): UseConnectorMutationResult {
  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computerId = computerData?.myComputer?.id ?? null;

  const [, enable] = useMutation(EnableConnectorMutation);
  const [, disable] = useMutation(DisableConnectorMutation);
  // Set so overlapping toggles don't clobber each other's pending state.
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  const toggle = useCallback(
    async (slug: string, nextConnected: boolean) => {
      if (!computerId) {
        toast.error("Couldn't resolve your Computer — please reload.");
        return;
      }
      setPendingSlugs((prev) => {
        const next = new Set(prev);
        next.add(slug);
        return next;
      });
      try {
        const result = nextConnected
          ? await enable(
              { input: { computerId, slug } },
              { additionalTypenames: [...CONNECTOR_TYPENAMES] },
            )
          : await disable(
              { input: { computerId, slug } },
              { additionalTypenames: [...CONNECTOR_TYPENAMES] },
            );
        if (result.error) {
          const code = result.error.graphQLErrors[0]?.extensions?.code;
          if (code === "CUSTOMIZE_MCP_NOT_SUPPORTED") {
            toast.message(MCP_VIA_MOBILE_HINT);
          } else {
            toast.error(result.error.message);
          }
        }
      } finally {
        setPendingSlugs((prev) => {
          if (!prev.has(slug)) return prev;
          const next = new Set(prev);
          next.delete(slug);
          return next;
        });
      }
    },
    [computerId, enable, disable],
  );

  return { toggle, pendingSlugs };
}

/**
 * urql wrapper for the Skills-tab Connect / Disable button. Mirrors
 * useConnectorMutation: resolves Computer id once, holds a pendingSlugs
 * Set so overlapping toggles don't clobber, surfaces the typed
 * built-in-tool error code as BUILTIN_TOOL_HINT.
 */
export function useSkillMutation(): UseToggleMutationResult {
  const [{ data: computerData }] = useQuery<MyComputerResult>({
    query: MyComputerQuery,
  });
  const computerId = computerData?.myComputer?.id ?? null;

  const [, enable] = useMutation(EnableSkillMutation);
  const [, disable] = useMutation(DisableSkillMutation);
  const [pendingSlugs, setPendingSlugs] = useState<Set<string>>(
    () => new Set(),
  );

  const toggle = useCallback(
    async (skillId: string, nextConnected: boolean) => {
      if (!computerId) {
        toast.error("Couldn't resolve your Computer — please reload.");
        return;
      }
      setPendingSlugs((prev) => {
        const next = new Set(prev);
        next.add(skillId);
        return next;
      });
      try {
        const result = nextConnected
          ? await enable(
              { input: { computerId, skillId } },
              { additionalTypenames: [...SKILL_TYPENAMES] },
            )
          : await disable(
              { input: { computerId, skillId } },
              { additionalTypenames: [...SKILL_TYPENAMES] },
            );
        if (result.error) {
          const code = result.error.graphQLErrors[0]?.extensions?.code;
          if (code === "CUSTOMIZE_BUILTIN_TOOL_NOT_ENABLEABLE") {
            toast.message(BUILTIN_TOOL_HINT);
          } else {
            toast.error(result.error.message);
          }
        }
      } finally {
        setPendingSlugs((prev) => {
          if (!prev.has(skillId)) return prev;
          const next = new Set(prev);
          next.delete(skillId);
          return next;
        });
      }
    },
    [computerId, enable, disable],
  );

  return { toggle, pendingSlugs };
}
