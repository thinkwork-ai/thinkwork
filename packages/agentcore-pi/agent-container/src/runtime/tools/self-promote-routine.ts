/**
 * self_promote_routine — autonomously promote a composed Routine (governed
 * autonomy U4).
 *
 * The agent has already used routine_propose to submit an immutable bundle.
 * This tool promotes that proposal with NO human — but ONLY when every pinned
 * capability dependency is auto-tier (public, read-only, no-credential,
 * reversible, fully classified). The backing Lambda enforces the per-tenant
 * opt-in and the auto-tier classifier fail-closed; a non-auto dependency
 * returns `held_for_review` (the proposal stays in the operator approval
 * queue). The hermetic fixture gate still runs on the promoted SHA (zero
 * external calls) — a red gate is NOT promoted.
 *
 * Tenant + agent identity are derived from the VERIFIED caller context
 * server-side. Never throws: transport/service failures return a text result
 * with a safe reason.
 */

import type { AgentTool } from "@earendil-works/pi-agent-core";
import type { LambdaClient } from "@aws-sdk/client-lambda";
import { Type } from "typebox";

import type { RuntimeEnvSnapshot } from "../../handler-context.js";
import {
  describeCapabilityControlFailure,
  invokeCapabilityControl,
} from "./capability-control-client.js";

export const SELF_PROMOTE_ROUTINE_TOOL_NAME = "self_promote_routine";

export interface SelfPromoteRoutineToolOptions {
  env: Pick<RuntimeEnvSnapshot, "capabilityControlFnName">;
  lambdaClient: Pick<LambdaClient, "send">;
  /** Signed capability caller context from the dispatch payload. */
  callerContext: string;
}

export function buildSelfPromoteRoutineTool(
  options: SelfPromoteRoutineToolOptions,
): AgentTool<any> {
  return {
    name: SELF_PROMOTE_ROUTINE_TOOL_NAME,
    label: "Self-Promote Routine",
    description:
      "Autonomously approve and promote a submitted Routine proposal so it " +
      "commits to Git and passes the hermetic fixture gate — with NO human. " +
      "Only routines whose every capability dependency is PUBLIC, read-only, " +
      "no-credential, and reversible self-promote; any credentialed or writing " +
      "dependency returns 'held_for_review' and waits in the operator approval " +
      "queue. A red hermetic gate is never promoted. Provide the proposalId " +
      "returned by routine_propose.",
    parameters: Type.Object({
      proposalId: Type.String({
        description:
          "The Routine proposal id to promote (from routine_propose).",
      }),
    }),
    execute: async (_toolCallId, params) => {
      const p = params as Record<string, unknown>;
      const outcome = await invokeCapabilityControl({
        request: {
          action: "self_approve_routine",
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
              text: `self_promote_routine unavailable — ${describeCapabilityControlFailure(outcome)}`,
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
