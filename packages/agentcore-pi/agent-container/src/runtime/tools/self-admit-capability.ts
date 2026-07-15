/**
 * self_admit_capability — autonomously admit a researched public capability
 * (governed autonomy U4).
 *
 * The agent has already used connection_research to draft a proposal from
 * official docs. This tool admits that proposal with NO human — but ONLY when
 * every operation is auto-tier (public, read-only, no-credential, reversible,
 * fully classified). The backing Lambda enforces the per-tenant opt-in and the
 * auto-tier classifier fail-closed; a non-auto descriptor returns
 * `held_for_review` (the proposal waits for an operator). On success it also
 * auto-provisions the service principal + credential binding so the capability
 * is immediately runnable, and returns the executable twcap ref.
 *
 * Tenant + agent identity are derived from the VERIFIED caller context
 * server-side — the plaintext proposalId can never assert another tenant.
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

export const SELF_ADMIT_CAPABILITY_TOOL_NAME = "self_admit_capability";

export interface SelfAdmitCapabilityToolOptions {
  env: Pick<RuntimeEnvSnapshot, "capabilityControlFnName">;
  lambdaClient: Pick<LambdaClient, "send">;
  /** Signed capability caller context from the dispatch payload. */
  callerContext: string;
}

export function buildSelfAdmitCapabilityTool(
  options: SelfAdmitCapabilityToolOptions,
): AgentTool<any> {
  return {
    name: SELF_ADMIT_CAPABILITY_TOOL_NAME,
    label: "Self-Admit Capability",
    description:
      "Autonomously admit a researched connection proposal so its operations " +
      "become admitted, signed, and runnable — with NO human. Only PUBLIC, " +
      "read-only, no-credential, reversible operations self-admit; anything " +
      "credentialed or that writes returns 'held_for_review' and waits for an " +
      "operator. On success this also provisions the binding, so the returned " +
      "twcap is immediately usable in a routine_propose. Provide the " +
      "proposalId returned by connection_research.",
    parameters: Type.Object({
      proposalId: Type.String({
        description:
          "The connection proposal id to admit (from connection_research).",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const p = params as Record<string, unknown>;
      const outcome = await invokeCapabilityControl({
        request: {
          action: "self_admit_connection",
          ...(typeof p.proposalId === "string"
            ? { proposalId: p.proposalId }
            : {}),
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
              text: `self_admit_capability unavailable — ${describeCapabilityControlFailure(outcome)}`,
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
