import { describe, expect, it } from "vitest";
import { GraphQLError } from "graphql";
import { assertTransition } from "./utils";

describe("assertTransition (real module)", () => {
  it("allows a valid transition", () => {
    expect(() => assertTransition("backlog", "todo")).not.toThrow();
  });

  it("rejects an invalid transition as BAD_USER_INPUT with the allowed list", () => {
    // The client shows this error verbatim — a plain Error surfaced as
    // INTERNAL_SERVER_ERROR and hid why the status change was refused.
    let caught: unknown;
    try {
      assertTransition("backlog", "done");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraphQLError);
    const graphQLError = caught as GraphQLError;
    expect(graphQLError.extensions.code).toBe("BAD_USER_INPUT");
    expect(graphQLError.message).toContain(
      "Invalid status transition: backlog → done",
    );
    expect(graphQLError.message).toContain("Allowed from backlog:");
    expect(graphQLError.message).toContain("todo");
  });

  it("rejects an unknown source status without an allowed list", () => {
    let caught: unknown;
    try {
      assertTransition("bogus", "done");
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(GraphQLError);
    expect((caught as GraphQLError).message).toBe(
      "Invalid status transition: bogus → done",
    );
  });
});
