import { describe, expect, it } from "vitest";
import { print } from "graphql";
import { ThreadQuery } from "../graphql-queries";

describe("ThreadQuery", () => {
  it("does not request attachment storage keys from the mobile detail query", () => {
    expect(print(ThreadQuery)).not.toContain("s3Key");
  });
});
