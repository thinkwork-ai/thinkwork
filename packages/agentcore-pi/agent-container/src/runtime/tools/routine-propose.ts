/**
 * routine_propose — propose a Routine for promotion (THINK-280 U6).
 *
 * Turns a successful private-Python digest into an IMMUTABLE, NON-EXECUTABLE
 * proposal. It can ONLY create/update a proposal; it CANNOT approve, commit,
 * validate, or activate — those code paths do not exist on the backing
 * Lambda. Tenant, actor, turn, manifest, and broker evidence are derived
 * from the VERIFIED caller context server-side; the authored bundle can
 * never assert another tenant/user or attach dependencies absent from that
 * context (the service validates dependencies against the tenant's admitted
 * capability versions).
 *
 * Never throws: transport/service failures return a text result with a safe
 * reason.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { Type } from "typebox";

import type { RuntimeEnvSnapshot } from "../../handler-context.js";
import {
  describeCapabilityControlFailure,
  invokeCapabilityControl,
} from "./capability-control-client.js";

export const ROUTINE_PROPOSE_TOOL_NAME = "routine_propose";

export interface RoutineProposeToolOptions {
  env: Pick<RuntimeEnvSnapshot, "capabilityControlFnName">;
  lambdaClient: Pick<LambdaClient, "send">;
  /** Signed capability caller context from the dispatch payload. */
  callerContext: string;
}

export function buildRoutineProposeTool(
  options: RoutineProposeToolOptions,
): AgentTool<any> {
  return {
    name: ROUTINE_PROPOSE_TOOL_NAME,
    label: "Propose Routine Promotion",
    description:
      "Turn a validated private-Python digest into an IMMUTABLE Routine " +
      "promotion proposal for operator review. Provide the whole bundle: " +
      "normalized code, typed input/output, minimized SANITIZED fixtures, " +
      "invariants, exact capability dependency refs, minimum grants, the " +
      "execution principal, an effect/data/cost summary, and the source " +
      "broker/turn evidence. This tool ONLY records a proposal — it cannot " +
      "approve, commit to Git, validate, or activate anything. Any edit " +
      "creates a new proposal and invalidates the prior one.",
    parameters: Type.Object({
      routineId: Type.Optional(
        Type.String({
          description: "Existing Routine id when proposing an update.",
        }),
      ),
      bundle: Type.Unknown({
        description:
          "The immutable proposal bundle (JSON object): { slug, code, " +
          "inputSchema, outputSchema, fixtures[], invariants[], " +
          "dependencies[{twcap,contractHash,definitionVersionId}], " +
          "minimumGrants, principal{mode}, effectSummary, evidence }.",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const p = params as Record<string, unknown>;
      const outcome = await invokeCapabilityControl({
        request: {
          action: "routine_propose",
          routineProposal: {
            ...(typeof p.routineId === "string"
              ? { routineId: p.routineId }
              : {}),
            bundle: p.bundle,
          },
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
              text: `routine_propose unavailable — ${describeCapabilityControlFailure(outcome)}`,
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
