import { GraphQLError } from "graphql";
import type { YogaInitialContext } from "graphql-yoga";
import { describe, expect, it, vi } from "vitest";

vi.mock("../lib/cognito-auth.js", () => ({
  authenticate: vi.fn(async () => null),
}));

describe("createContext", () => {
  it("returns a coded GraphQL auth error instead of a generic 500-maskable error", async () => {
    const { createContext } = await import("./context.js");
    const context = {
      request: new Request("https://example.test/graphql"),
    } satisfies Pick<YogaInitialContext, "request">;

    let rejected: unknown;
    try {
      await createContext(context as YogaInitialContext);
    } catch (err) {
      rejected = err;
    }

    expect(rejected).toBeInstanceOf(GraphQLError);
    expect(rejected).toMatchObject({
      message: "Authentication required",
      extensions: { code: "UNAUTHENTICATED" },
    });
  });
});
