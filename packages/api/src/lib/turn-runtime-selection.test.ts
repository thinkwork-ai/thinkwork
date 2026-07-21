import { describe, expect, it } from "vitest";
import {
  InvalidRequestedRuntimeError,
  requestedRuntimeFromMetadata,
} from "./turn-runtime-selection.js";

describe("requestedRuntimeFromMetadata", () => {
  it("returns null only when no runtime is pinned", () => {
    expect(requestedRuntimeFromMetadata(undefined)).toBeNull();
    expect(requestedRuntimeFromMetadata(null)).toBeNull();
    expect(requestedRuntimeFromMetadata({})).toBeNull();
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "" })).toBeNull();
  });

  it("returns an explicit Pi pin", () => {
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "pi" })).toBe("pi");
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "PI" })).toBe("pi");
  });

  it("normalizes legacy harness selectors to Pi (THINK-324)", () => {
    expect(
      requestedRuntimeFromMetadata({ requestedRuntime: "agentcore" }),
    ).toBe("pi");
    expect(
      requestedRuntimeFromMetadata({ requestedRuntime: "AgentCore" }),
    ).toBe("pi");
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "harness" })).toBe(
      "pi",
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
