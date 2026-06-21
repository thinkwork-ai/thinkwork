import process from "node:process";
import type { ExtensionFactory } from "@thinkwork/pi-extensions";
import piGoal from "./vendor/narumitw-pi-goal.js";

export const PI_GOAL_TOOL_NAMES = ["goal_complete"] as const;

export interface PiGoalAdapterOptions {
  agentDir: string;
}

export function createPiGoalExtensionFactory(
  options: PiGoalAdapterOptions,
): ExtensionFactory {
  return async (pi) => {
    const previousAgentDir = process.env.PI_CODING_AGENT_DIR;
    process.env.PI_CODING_AGENT_DIR = options.agentDir;
    try {
      await piGoal(pi);
    } finally {
      if (previousAgentDir === undefined) {
        delete process.env.PI_CODING_AGENT_DIR;
      } else {
        process.env.PI_CODING_AGENT_DIR = previousAgentDir;
      }
    }
  };
}

export function hasPiGoalMode(payload: Record<string, unknown>): boolean {
  const goalMode = payload.goal_mode ?? payload.goalMode;
  if (!goalMode || typeof goalMode !== "object" || Array.isArray(goalMode)) {
    return false;
  }
  const record = goalMode as Record<string, unknown>;
  return (
    record.enabled === true ||
    record.action === "start" ||
    record.action === "resume" ||
    record.action === "pause" ||
    record.action === "cancel" ||
    record.action === "clear"
  );
}
