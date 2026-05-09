import { GraphQLError } from "graphql";

export function inertAppletResolver(): never {
  throw new GraphQLError("INERT_NOT_WIRED: computer applet API is not wired yet", {
    extensions: { code: "NOT_IMPLEMENTED" },
  });
}
