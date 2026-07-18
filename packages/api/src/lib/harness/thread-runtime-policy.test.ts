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

  it("selects Harness only for a stored future-thread preference", () => {
    expect(
      defaultThreadRuntimeFromConfig({ defaultThreadRuntime: "harness" }),
    ).toBe("agentcore");
    expect(
      defaultThreadRuntimeFromConfig({ defaultThreadRuntime: "agentcore" }),
    ).toBe("agentcore");
  });

  it("pins each normal thread without discarding caller metadata", () => {
    expect(
      pinThreadRuntimeMetadata({ source: "composer" }, "agentcore"),
    ).toEqual({ source: "composer", requestedRuntime: "agentcore" });
    expect(pinThreadRuntimeMetadata(undefined, "pi")).toEqual({
      requestedRuntime: "pi",
    });
  });

  it("prefers an explicit turn override, then the immutable thread pin", () => {
    expect(
      requestedRuntimeForTurn(
        { requestedRuntime: "pi" },
        { requestedRuntime: "agentcore" },
      ),
    ).toBe("pi");
    expect(
      requestedRuntimeForTurn(undefined, { requestedRuntime: "agentcore" }),
    ).toBe("agentcore");
    expect(requestedRuntimeForTurn(undefined, undefined)).toBeNull();
  });
});
