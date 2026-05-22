import type {
  GuardrailPayload,
  AgentRuntimeConfig,
} from "../resolve-agent-runtime-config.js";
import type { TemplateSandboxConfig } from "../sandbox-preflight.js";

export interface SpaceRuntimeOverrides {
  modelOverride: string | null;
  guardrailIdOverride: string | null;
  guardrailConfigOverride?: GuardrailPayload;
  budgetMonthlyCentsOverride: number | null;
  budgetPausedOverride: boolean | null;
  sandboxOverride: boolean | null;
}

export type RuntimeOverrideBaseline = Pick<
  AgentRuntimeConfig,
  | "templateModel"
  | "guardrailId"
  | "guardrailConfig"
  | "budgetMonthlyCents"
  | "budgetPaused"
  | "sandboxTemplate"
>;

export function applyRuntimeOverrides<T extends RuntimeOverrideBaseline>(
  baseline: T,
  overrides: SpaceRuntimeOverrides | null | undefined,
): T {
  if (!overrides) return baseline;

  const resolved = { ...baseline };

  if (overrides.modelOverride !== null) {
    resolved.templateModel = overrides.modelOverride;
  }
  if (overrides.guardrailIdOverride !== null) {
    resolved.guardrailId = overrides.guardrailIdOverride;
    resolved.guardrailConfig = overrides.guardrailConfigOverride;
  }
  if (overrides.budgetMonthlyCentsOverride !== null) {
    resolved.budgetMonthlyCents = overrides.budgetMonthlyCentsOverride;
  }
  if (overrides.budgetPausedOverride !== null) {
    resolved.budgetPaused = overrides.budgetPausedOverride;
  }
  if (overrides.sandboxOverride !== null) {
    resolved.sandboxTemplate =
      overrides.sandboxOverride === false
        ? null
        : keepBaselineSandbox(resolved.sandboxTemplate);
  }

  return resolved;
}

function keepBaselineSandbox(
  sandbox: TemplateSandboxConfig | null,
): TemplateSandboxConfig | null {
  return sandbox;
}
