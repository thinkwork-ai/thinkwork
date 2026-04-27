import { GraphQLError } from "graphql";

export type AgentRuntimeDb = "strands" | "pi";
export type AgentRuntimeGraphql = "STRANDS" | "PI";

export function parseAgentRuntimeInput(value: unknown): AgentRuntimeDb {
  if (value == null) return "strands";

  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "pi") return normalized;

  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphql(value: unknown): AgentRuntimeGraphql {
  return String(value).toLowerCase() === "pi" ? "PI" : "STRANDS";
}

export function withGraphqlAgentRuntime<T extends Record<string, unknown>>(
  value: T,
): T & { runtime: AgentRuntimeGraphql } {
  return {
    ...value,
    runtime: agentRuntimeToGraphql(value.runtime),
  };
}
