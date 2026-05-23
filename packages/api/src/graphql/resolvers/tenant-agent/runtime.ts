import { GraphQLError } from "graphql";

export function parseAgentRuntimeInput(value: unknown): "strands" | "flue" {
  if (value == null) return "strands";
  const normalized = String(value).toLowerCase();
  if (normalized === "strands" || normalized === "flue") return normalized;
  throw new GraphQLError("Invalid agent runtime", {
    extensions: { code: "BAD_USER_INPUT" },
  });
}
