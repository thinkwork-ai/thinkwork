import { describe, expect, it, vi } from "vitest";
import {
  APPROVED_MODEL_STORAGE_KEY,
  chooseApprovedModelId,
  formatModelCostLine,
  formatModelProvider,
  readStoredModelId,
  writeStoredModelId,
} from "./approved-model-selection";

const models = [
  {
    id: "m1",
    modelId: "anthropic.claude-sonnet",
    displayName: "Claude Sonnet",
    provider: "amazon_bedrock",
    inputCostPerMillion: 3,
    outputCostPerMillion: 15,
  },
  {
    id: "m2",
    modelId: "anthropic.claude-haiku",
    displayName: "Claude Haiku",
    provider: "amazon_bedrock",
    inputCostPerMillion: 0.15,
    outputCostPerMillion: 0.6,
  },
];

describe("approved model selection", () => {
  it("formats provider and token cost context", () => {
    expect(formatModelProvider("amazon_bedrock")).toBe("Amazon Bedrock");
    expect(formatModelCostLine(models[1]!)).toBe(
      "$0.15 input / $0.60 output per 1M tokens",
    );
  });

  it("keeps a preferred approved model and falls back to the first approved model", () => {
    expect(chooseApprovedModelId(models, "anthropic.claude-haiku")).toBe(
      "anthropic.claude-haiku",
    );
    expect(chooseApprovedModelId(models, "missing-model")).toBe(
      "anthropic.claude-sonnet",
    );
    expect(chooseApprovedModelId([], "anthropic.claude-haiku")).toBeNull();
  });

  it("persists and clears the selected model id", () => {
    const storage = {
      getItem: vi.fn(),
      removeItem: vi.fn(),
      setItem: vi.fn(),
    } as unknown as Storage;

    writeStoredModelId("anthropic.claude-haiku", storage);
    expect(storage.setItem).toHaveBeenCalledWith(
      APPROVED_MODEL_STORAGE_KEY,
      "anthropic.claude-haiku",
    );

    writeStoredModelId(null, storage);
    expect(storage.removeItem).toHaveBeenCalledWith(APPROVED_MODEL_STORAGE_KEY);

    vi.mocked(storage.getItem).mockReturnValue("anthropic.claude-sonnet");
    expect(readStoredModelId(storage)).toBe("anthropic.claude-sonnet");
  });
});
