import { GraphQLError } from "graphql";

export function parseAgentRuntimeInput(value: unknown): "strands" | "pi" {
  if (value == null) return "strands";
  const normalized = String(value).toLowerCase();
  if (normalized === "strands") return "strands";
  if (normalized === "pi" || normalized === "flue") return "pi";
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphqlEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  if (normalized === "pi" || normalized === "flue") return "FLUE";
  if (normalized === "strands") return "STRANDS";
  return value.toUpperCase();
}
