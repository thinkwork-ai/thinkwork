import { describe, expect, it } from "vitest";

import {
  type ModelProvider,
  UnsupportedModelError,
} from "../src/model-provider.js";

/**
 * A host-shaped stub: a fixed support set and a resolve that throws the typed
 * error on anything outside it. Proves a host can satisfy the contract with no
 * concrete AWS/Bedrock client — the inert-substitutability scenario for U3.
 */
function makeStub(supported: string[]): ModelProvider<{ id: string }> {
  const set = new Set(supported);
  return {
    supports: (modelId) => set.has(modelId),
    resolve: (modelId) => {
      if (!set.has(modelId)) {
        throw new UnsupportedModelError(modelId, supported);
      }
      return { id: modelId };
    },
  };
}

describe("ModelProvider contract", () => {
  it("reports support membership via supports()", () => {
    const provider = makeStub(["us.amazon.nova-pro-v1:0"]);
    expect(provider.supports("us.amazon.nova-pro-v1:0")).toBe(true);
    expect(provider.supports("anthropic.claude-sonnet")).toBe(false);
  });

  it("resolves a supported model to the host representation", () => {
    const provider = makeStub(["us.amazon.nova-pro-v1:0"]);
    expect(provider.resolve("us.amazon.nova-pro-v1:0")).toEqual({
      id: "us.amazon.nova-pro-v1:0",
    });
  });

  it("throws UnsupportedModelError on an unsupported id (no silent fallback)", () => {
    const provider = makeStub(["us.amazon.nova-pro-v1:0"]);
    expect(() => provider.resolve("kimi-k2")).toThrowError(
      UnsupportedModelError,
    );
  });

  it("can be constructed and exercised without any concrete client (inert)", () => {
    const provider = makeStub(["model-a", "model-b"]);
    expect(provider.supports("model-b")).toBe(true);
    expect(provider.resolve("model-a")).toEqual({ id: "model-a" });
  });
});

describe("UnsupportedModelError", () => {
  it("is an Error subclass with a stable name and carries the model id", () => {
    const err = new UnsupportedModelError("kimi-k2", ["a", "b"]);
    expect(err).toBeInstanceOf(Error);
    expect(err).toBeInstanceOf(UnsupportedModelError);
    expect(err.name).toBe("UnsupportedModelError");
    expect(err.modelId).toBe("kimi-k2");
    expect(err.supportedModelIds).toEqual(["a", "b"]);
  });

  it("lists the supported models in its message when provided", () => {
    const err = new UnsupportedModelError("kimi-k2", ["a", "b"]);
    expect(err.message).toContain("kimi-k2");
    expect(err.message).toContain("a, b");
  });

  it("omits the supported-models clause when none are provided", () => {
    const err = new UnsupportedModelError("kimi-k2");
    expect(err.message).toContain("kimi-k2");
    expect(err.supportedModelIds).toBeUndefined();
  });
});
