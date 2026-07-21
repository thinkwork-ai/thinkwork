import { GraphQLError } from "graphql";

/**
 * THINK-324: Pi is the only runtime. Legacy "agentcore"/"harness" inputs
 * (old clients, stored rows from the retired managed-harness trial)
 * normalize to Pi; anything else is a bad input.
 */
export function parseAgentRuntimeInput(value: unknown): "strands" | "pi" {
  if (value == null) return "pi";
  const normalized = String(value).toLowerCase();
  if (
    normalized === "strands" ||
    normalized === "pi" ||
    normalized === "flue" ||
    normalized === "agentcore" ||
    normalized === "harness"
  ) {
    return "pi";
  }
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}

export function agentRuntimeToGraphqlEnum(value: unknown): unknown {
  if (typeof value !== "string") return value;
  const normalized = value.toLowerCase();
  if (
    normalized === "pi" ||
    normalized === "flue" ||
    normalized === "strands" ||
    // Legacy managed-harness rows read as the Pi runtime (THINK-324).
    normalized === "harness" ||
    normalized === "agentcore"
  ) {
    return "FLUE";
  }
  return value.toUpperCase();
}
