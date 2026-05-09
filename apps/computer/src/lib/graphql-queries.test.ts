import { print } from "graphql";
import { describe, expect, it } from "vitest";
import { ThreadTurnUpdatedSubscription } from "./graphql-queries";

describe("computer GraphQL queries", () => {
  it("requests tenantId on thread-turn updates so list subscriptions can refresh", () => {
    expect(print(ThreadTurnUpdatedSubscription)).toContain("tenantId");
  });
});
