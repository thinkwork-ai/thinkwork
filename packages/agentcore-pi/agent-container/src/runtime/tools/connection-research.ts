/**
 * connection_research — the RESEARCH discovery tool (THINK-280 U2).
 *
 * Searches admitted/platform capability definitions and stored connection
 * proposals, and can record a draft proposal (non-executable evidence with
 * official https source URLs). It CANNOT sign, bind credentials, or
 * dispatch — admission is an operator mutation on the web surface, and the
 * backing Lambda has no such code paths. Research output never appears in
 * `capability_search` (working knowledge is admitted contracts only).
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

export const CONNECTION_RESEARCH_TOOL_NAME = "connection_research";

export interface ConnectionResearchToolOptions {
  env: Pick<RuntimeEnvSnapshot, "capabilityControlFnName">;
  lambdaClient: Pick<LambdaClient, "send">;
  /** Signed capability caller context from the dispatch payload. */
  callerContext: string;
}

export function buildConnectionResearchTool(
  options: ConnectionResearchToolOptions,
): AgentTool<any> {
  return {
    name: CONNECTION_RESEARCH_TOOL_NAME,
    label: "Connection Research",
    description:
      "Search admitted capability definitions and stored connection " +
      "proposals, and optionally record a DRAFT connection proposal " +
      "(non-executable research evidence; every material claim needs an " +
      "official https source URL). Only an operator admission can turn a " +
      "proposal into a working capability — this tool cannot sign, bind " +
      "credentials, or execute anything.",
    parameters: Type.Object({
      query: Type.String({
        description: "Search text (slug / display name / namespace).",
      }),
      allowExternal: Type.Optional(
        Type.Boolean({
          description:
            "Permit the bounded external-discovery fetch (may degrade; " +
            "stored knowledge is always returned).",
        }),
      ),
      proposal: Type.Optional(
        Type.Object(
          {
            definitionId: Type.Optional(
              Type.String({
                description: "Existing definition id when refreshing.",
              }),
            ),
            payload: Type.Unknown({
              description:
                "Proposed descriptor + research evidence (JSON object).",
            }),
            sourceUrls: Type.Array(Type.String(), {
              description:
                "Official provider https URLs backing every material claim.",
            }),
          },
          {
            description:
              "Draft connection proposal to record as research evidence.",
          },
        ),
      ),
    }),
    execute: async (_toolCallId, params) => {
      const p = params as Record<string, unknown>;
      const proposal =
        p.proposal && typeof p.proposal === "object"
          ? (p.proposal as {
              definitionId?: string;
              payload: unknown;
              sourceUrls: string[];
            })
          : undefined;
      const outcome = await invokeCapabilityControl({
        request: {
          action: "connection_research",
          query: String(p.query ?? ""),
          ...(p.allowExternal === true ? { allowExternal: true } : {}),
          ...(proposal ? { proposal } : {}),
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
              text: `connection_research unavailable — ${describeCapabilityControlFailure(outcome)}`,
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
