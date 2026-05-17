import { describe, expect, it } from "vitest";
import { print } from "graphql";
import {
  AssignedComputersQuery,
  ComputersQuery,
  ThreadQuery,
} from "../graphql-queries";

describe("ThreadQuery", () => {
  it("does not request attachment storage keys from the mobile detail query", () => {
    expect(print(ThreadQuery)).not.toContain("s3Key");
  });

  it("uses assigned Computers as the mobile Computer picker contract", () => {
    expect(print(AssignedComputersQuery)).toContain("assignedComputers");
    expect(print(AssignedComputersQuery)).not.toContain("myComputer");
    expect(print(ComputersQuery)).not.toContain("ownerUserId");
  });
});
