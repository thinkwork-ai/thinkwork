import { describe, expect, it } from "vitest";
import { applyRuntimeOverrides } from "./runtime-overrides-applier.js";
import type { AgentRuntimeConfig } from "../resolve-agent-runtime-config.js";

const baseline = {
  templateModel: "us.anthropic.claude-sonnet-4-6",
  guardrailId: "guardrail-base",
  guardrailConfig: {
    guardrailIdentifier: "bg-base",
    guardrailVersion: "1",
  },
  budgetMonthlyCents: 10_000,
  budgetPaused: false,
  sandboxTemplate: { environment: "default-public" },
} satisfies Pick<
  AgentRuntimeConfig,
  | "templateModel"
  | "guardrailId"
  | "guardrailConfig"
  | "budgetMonthlyCents"
  | "budgetPaused"
  | "sandboxTemplate"
>;

describe("applyRuntimeOverrides", () => {
  it("returns the baseline when a Space has no override values", () => {
    expect(
      applyRuntimeOverrides(baseline, {
        modelOverride: null,
        guardrailIdOverride: null,
        budgetMonthlyCentsOverride: null,
        budgetPausedOverride: null,
        sandboxOverride: null,
      }),
    ).toEqual(baseline);
  });

  it("overlays non-null Space runtime fields", () => {
    expect(
      applyRuntimeOverrides(baseline, {
        modelOverride: "us.anthropic.claude-opus-4-7",
        guardrailIdOverride: "guardrail-finance",
        guardrailConfigOverride: {
          guardrailIdentifier: "bg-finance",
          guardrailVersion: "2",
        },
        budgetMonthlyCentsOverride: 25_000,
        budgetPausedOverride: true,
        sandboxOverride: false,
      }),
    ).toMatchObject({
      templateModel: "us.anthropic.claude-opus-4-7",
      guardrailId: "guardrail-finance",
      guardrailConfig: {
        guardrailIdentifier: "bg-finance",
        guardrailVersion: "2",
      },
      budgetMonthlyCents: 25_000,
      budgetPaused: true,
      sandboxTemplate: null,
    });
  });

  it("does not use sandboxOverride=true to create sandbox access from null baseline", () => {
    expect(
      applyRuntimeOverrides(
        { ...baseline, sandboxTemplate: null },
        {
          modelOverride: null,
          guardrailIdOverride: null,
          budgetMonthlyCentsOverride: null,
          budgetPausedOverride: null,
          sandboxOverride: true,
        },
      ).sandboxTemplate,
    ).toBeNull();
  });
});
