import { describe, expect, it } from "vitest";

import {
  defaultThreadRuntimeFromConfig,
  pinThreadRuntimeMetadata,
  requestedRuntimeForTurn,
} from "./thread-runtime-policy.js";

describe("Harness thread runtime policy", () => {
  it("keeps Pi as the default when no future-thread preference is stored", () => {
    expect(defaultThreadRuntimeFromConfig(null)).toBe("pi");
    expect(defaultThreadRuntimeFromConfig({})).toBe("pi");
  });

  it("normalizes legacy harness future-thread preferences to Pi (THINK-324)", () => {
    expect(
      defaultThreadRuntimeFromConfig({ defaultThreadRuntime: "harness" }),
    ).toBe("pi");
    expect(
      defaultThreadRuntimeFromConfig({ defaultThreadRuntime: "agentcore" }),
    ).toBe("pi");
  });

  it("pins each normal thread without discarding caller metadata", () => {
    expect(pinThreadRuntimeMetadata({ source: "composer" }, "pi")).toEqual({
      source: "composer",
      requestedRuntime: "pi",
    });
    expect(pinThreadRuntimeMetadata(undefined, "pi")).toEqual({
      requestedRuntime: "pi",
    });
  });

  it("prefers an explicit turn override; legacy harness pins resolve to Pi", () => {
    expect(
      requestedRuntimeForTurn(
        { requestedRuntime: "pi" },
        { requestedRuntime: "agentcore" },
      ),
    ).toBe("pi");
    expect(
      requestedRuntimeForTurn(undefined, { requestedRuntime: "agentcore" }),
    ).toBe("pi");
    expect(requestedRuntimeForTurn(undefined, undefined)).toBeNull();
  });
});
