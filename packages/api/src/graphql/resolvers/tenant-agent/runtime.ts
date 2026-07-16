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
  // THINK-311: "harness" is the operator-managed trial selector; the
  // AgentRuntime GraphQL enum deliberately stays FLUE-only so agent
  // queries keep working for a flagged agent. The trial flag is set via
  // SQL on the trial stage, never through this API (parseAgentRuntimeInput
  // rejects it), and trial evidence lives on thread turns, not here.
  if (
    normalized === "pi" ||
    normalized === "flue" ||
    normalized === "strands" ||
    normalized === "harness"
  )
    return "FLUE";
  return value.toUpperCase();
}
