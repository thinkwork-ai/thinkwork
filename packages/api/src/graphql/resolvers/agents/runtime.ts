import { GraphQLError } from "graphql";

export type AgentRuntimeDb = "strands" | "flue";
export type AgentRuntimeGraphql = "STRANDS" | "FLUE";

export function parseAgentRuntimeInput(value: unknown): AgentRuntimeDb {
  if (value == null) return "strands";

  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "flue") return normalized;

  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphql(value: unknown): AgentRuntimeGraphql {
  return String(value).toLowerCase() === "flue" ? "FLUE" : "STRANDS";
}

export function withGraphqlAgentRuntime<T extends Record<string, unknown>>(
  value: T,
): T & { runtime: AgentRuntimeGraphql } {
  return {
    ...value,
    runtime: agentRuntimeToGraphql(value.runtime),
  };
}
