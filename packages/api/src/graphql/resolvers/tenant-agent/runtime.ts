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
