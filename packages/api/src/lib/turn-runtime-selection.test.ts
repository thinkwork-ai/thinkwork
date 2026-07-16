import { describe, expect, it } from "vitest";
import {
  InvalidRequestedRuntimeError,
  requestedRuntimeFromMetadata,
} from "./turn-runtime-selection.js";

describe("requestedRuntimeFromMetadata", () => {
  it("returns null for absent metadata, absent key, empty, and pi", () => {
    expect(requestedRuntimeFromMetadata(undefined)).toBeNull();
    expect(requestedRuntimeFromMetadata(null)).toBeNull();
    expect(requestedRuntimeFromMetadata({})).toBeNull();
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "" })).toBeNull();
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "pi" })).toBeNull();
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "PI" })).toBeNull();
  });

  it("returns agentcore for the trial selector (harness accepted as alias)", () => {
    expect(
      requestedRuntimeFromMetadata({ requestedRuntime: "agentcore" }),
    ).toBe("agentcore");
    expect(
      requestedRuntimeFromMetadata({ requestedRuntime: "AgentCore" }),
    ).toBe("agentcore");
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "harness" })).toBe(
      "agentcore",
    );
  });

  it("throws on anything else instead of silently running Pi (R4)", () => {
    expect(() =>
      requestedRuntimeFromMetadata({ requestedRuntime: "agentcore2" }),
    ).toThrow(InvalidRequestedRuntimeError);
    expect(() =>
      requestedRuntimeFromMetadata({ requestedRuntime: 42 }),
    ).toThrow(InvalidRequestedRuntimeError);
  });
});
