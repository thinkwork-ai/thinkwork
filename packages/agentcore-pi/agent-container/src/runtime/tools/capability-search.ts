/**
 * capability_search — the WORKING projection tool (THINK-280 U2).
 *
 * Resolves ONE exact invocation tuple (namespace/class/slug[/version]/
 * operationId + principal mode) against the tenant's admitted, signed
 * capability contracts via the capability-control-service Lambda. Only
 * active granted operations whose exact contract and binding are available
 * resolve; research records and unsigned proposals can never appear here —
 * use `connection_research` for discovery.
 *
 * Never throws: transport/service failures return a text result with a
 * safe reason (`describeCapabilityControlFailure`).
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { Type } from "typebox";

import type { RuntimeEnvSnapshot } from "../../handler-context.js";
import {
  describeCapabilityControlFailure,
  invokeCapabilityControl,
} from "./capability-control-client.js";

export const CAPABILITY_SEARCH_TOOL_NAME = "capability_search";

export interface CapabilitySearchToolOptions {
  env: Pick<RuntimeEnvSnapshot, "capabilityControlFnName">;
  lambdaClient: Pick<LambdaClient, "send">;
  /** Signed capability caller context from the dispatch payload. */
  callerContext: string;
}

export function buildCapabilitySearchTool(
  options: CapabilitySearchToolOptions,
): AgentTool<any> {
  return {
    name: CAPABILITY_SEARCH_TOOL_NAME,
    label: "Capability Search",
    description:
      "Resolve one EXACT admitted capability operation (namespace, class, " +
      "slug, operationId, principal mode) to its executable twcap contract " +
      "reference. Working knowledge only — admitted + credential-ready " +
      "operations resolve; drafts and research proposals never appear here.",
    parameters: Type.Object({
      namespace: Type.String({ description: "twcap namespace segment." }),
      class: Type.String({
        description: "twcap class segment (e.g. 'connection').",
      }),
      slug: Type.String({ description: "twcap slug segment." }),
      operationId: Type.String({
        description: "Provider-native operation id, exact.",
      }),
      version: Type.Optional(
        Type.String({
          description:
            "Decimal admitted version; omit for the latest admitted version.",
        }),
      ),
      principalMode: Type.String({
        description: "requester | agent_owner | service — exact, no fallback.",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const p = params as Record<string, unknown>;
      const outcome = await invokeCapabilityControl({
        request: {
          action: "capability_search",
          tuple: {
            namespace: String(p.namespace ?? ""),
            class: String(p.class ?? ""),
            slug: String(p.slug ?? ""),
            operationId: String(p.operationId ?? ""),
            ...(typeof p.version === "string" && p.version
              ? { version: p.version }
              : {}),
          },
          principalMode: String(p.principalMode ?? ""),
        },
        callerContext: options.callerContext,
        env: options.env,
        lambdaClient: options.lambdaClient,
      });

      if (!outcome.ok) {
        return {
          content: [
            {
              type: "text",
              text: `capability_search unavailable — ${describeCapabilityControlFailure(outcome)}`,
            },
          ],
          details: { ok: false, reason: outcome.reason },
        };
      }

      return {
        content: [
          {
            type: "text",
            text: JSON.stringify(outcome.result, null, 2),
          },
        ],
        details: { ok: true, result: outcome.result },
      };
    },
  };
}
