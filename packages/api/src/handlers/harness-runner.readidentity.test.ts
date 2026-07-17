import { describe, expect, it } from "vitest";
import { readIdentity, unwrapHarness } from "./harness-runner.js";

describe("harness control-plane response parsing", () => {
  const doc = {
    harnessId: "h-123",
    harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/h-123",
    harnessVersion: "1",
    status: "READY",
  };

  it("reads identity from a wrapped CreateHarness response (SDK 3.1088 live shape)", () => {
    expect(readIdentity({ harness: doc, $metadata: {} })).toEqual({
      harnessId: "h-123",
      harnessArn: "arn:aws:bedrock-agentcore:us-east-1:1:harness/h-123",
      harnessVersion: "1",
    });
  });

  it("reads identity from an unwrapped summary (ListHarnesses item)", () => {
    expect(readIdentity(doc).harnessId).toBe("h-123");
  });

  it("unwrapHarness passes through unwrapped documents", () => {
    expect(unwrapHarness(doc)).toBe(doc);
    expect(unwrapHarness({ harness: doc })).toBe(doc);
  });

  it("still fails loudly when identity is genuinely absent", () => {
    expect(() => readIdentity({ $metadata: {} })).toThrow(
      /missing identity fields/,
    );
  });
});
