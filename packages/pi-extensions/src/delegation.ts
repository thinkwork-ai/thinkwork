import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import { Type } from "typebox";

import {
  defineExtension,
  requireProvider,
  type ThinkworkExtension,
} from "./define-extension.js";

export interface DelegationExtensionOptions {
  enabled?: boolean;
}

function asString(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function createDelegationExtension(
  options: DelegationExtensionOptions = {},
): ThinkworkExtension {
  const enabled = options.enabled ?? true;
  return defineExtension({
    name: "thinkwork-delegation",
    toolNames: enabled ? ["delegate_to_managed_agent"] : [],
    register(pi, providers) {
      if (!enabled) return;
      const delegation = requireProvider(
        providers,
        "delegation",
        "thinkwork-delegation",
      );

      const tool: ToolDefinition = {
        name: "delegate_to_managed_agent",
        label: "Delegate",
        description:
          "Ask a managed AWS ThinkWork agent worker to perform hosted, long-running, risky, or cloud-isolated work.",
        parameters: Type.Object({
          task: Type.String({
            description: "Concrete work for the managed agent to perform.",
          }),
          visibility: Type.Optional(
            Type.Union([Type.Literal("hidden"), Type.Literal("visible")], {
              description:
                "Use hidden for routine helper work; visible for consequential, long-running, risky, or user-steerable work.",
            }),
          ),
          reason: Type.Optional(
            Type.String({
              description: "Short reason the work should run in AWS.",
            }),
          ),
          timeoutMs: Type.Optional(
            Type.Number({
              description:
                "How long to wait for a hidden delegation result before returning accepted status.",
            }),
          ),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const typed = (params ?? {}) as Record<string, unknown>;
          const task = asString(typed.task) ?? "";
          if (!task) {
            throw new Error(
              "delegate_to_managed_agent requires a non-empty task.",
            );
          }
          const visibility =
            typed.visibility === "visible" || typed.visibility === "hidden"
              ? typed.visibility
              : "hidden";
          const result = await delegation.delegate({
            task,
            visibility,
            reason: asString(typed.reason),
            timeoutMs:
              typeof typed.timeoutMs === "number" ? typed.timeoutMs : undefined,
          });
          return {
            content: [{ type: "text", text: JSON.stringify(result) }],
            details: result,
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}
