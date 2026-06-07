import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import {
  applyModelApproval,
  formatModelCostLine,
  formatPerMillionCost,
  formatProviderName,
} from "./UserModelsSection";

describe("UserModelsSection", () => {
  it("formats provider and per-million token costs for compact model rows", () => {
    expect(formatProviderName("amazon_bedrock")).toBe("Amazon Bedrock");
    expect(formatPerMillionCost(0.15)).toBe("$0.15");
    expect(formatPerMillionCost(0.00012)).toBe("$0.0001");
    expect(formatPerMillionCost(null)).toBe("n/a");
    expect(
      formatModelCostLine({
        inputCostPerMillion: 0.15,
        outputCostPerMillion: 0.6,
      }),
    ).toBe("$0.15 input / $0.60 output per 1M tokens");
  });

  it("updates only the toggled model when applying optimistic approval state", () => {
    const models = [
      { approved: true, modelId: "openai.gpt-5" },
      { approved: false, modelId: "anthropic.claude-haiku" },
    ];

    const updated = applyModelApproval(models, "anthropic.claude-haiku", true);

    expect(updated).toEqual([
      { approved: true, modelId: "openai.gpt-5" },
      { approved: true, modelId: "anthropic.claude-haiku" },
    ]);
    expect(updated[0]).toBe(models[0]);
    expect(updated[1]).not.toBe(models[1]);
  });

  it("wires catalog query, mutation, rollback, and switches in Spaces settings", () => {
    const source = readFileSync(
      `${process.cwd()}/src/components/settings/UserModelsSection.tsx`,
      "utf8",
    );

    expect(source).toContain("SettingsSection label=\"Models\"");
    expect(source).toContain("UserModelCatalogQuery");
    expect(source).toContain("SetUserModelApprovalMutation");
    expect(source).toContain('requestPolicy: "cache-and-network"');
    expect(source).toContain(
      "setModels(applyModelApproval(rows, modelId, approved))",
    );
    expect(source).toContain("setModels(previousModels)");
    expect(source).toContain("toast.error");
    expect(source).toContain("toast.success");
    expect(source).toContain("aria-label={`Approve ${model.displayName}`}");
    expect(source).toContain("formatModelCostLine(model)");
  });
});
