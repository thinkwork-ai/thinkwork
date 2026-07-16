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

  it("returns harness for the trial selector", () => {
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "harness" })).toBe(
      "harness",
    );
    expect(requestedRuntimeFromMetadata({ requestedRuntime: "Harness" })).toBe(
      "harness",
    );
  });

  it("throws on anything else instead of silently running Pi (R4)", () => {
    expect(() =>
      requestedRuntimeFromMetadata({ requestedRuntime: "harness2" }),
    ).toThrow(InvalidRequestedRuntimeError);
    expect(() =>
      requestedRuntimeFromMetadata({ requestedRuntime: 42 }),
    ).toThrow(InvalidRequestedRuntimeError);
  });
});
