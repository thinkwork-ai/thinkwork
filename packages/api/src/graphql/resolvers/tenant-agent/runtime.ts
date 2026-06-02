import { GraphQLError } from "graphql";

export function parseAgentRuntimeInput(value: unknown): "strands" | "pi" {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "pi" || normalized === "flue")
    return "pi";
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphqlEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  if (normalized === "pi" || normalized === "flue" || normalized === "strands")
    return "FLUE";
  return value.toUpperCase();
}
