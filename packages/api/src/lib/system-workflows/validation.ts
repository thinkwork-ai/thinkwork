import { getSystemWorkflowDefinition } from "./registry.js";

export type SystemWorkflowValidationResult = {
  valid: boolean;
  errors: Array<{ field: string; message: string }>;
};

export function validateSystemWorkflowConfig(
  workflowId: string,
  config: Record<string, unknown>,
): SystemWorkflowValidationResult {
  const definition = getSystemWorkflowDefinition(workflowId);
  if (!definition) {
    return {
      valid: false,
      errors: [{ field: "workflowId", message: "Unknown system workflow" }],
    };
  }

  const errors: Array<{ field: string; message: string }> = [];
  for (const field of definition.configSchema) {
    const value = config[field.key];
    if (field.required && value == null) {
      errors.push({ field: field.key, message: "Required" });
      continue;
    }
    if (value == null) continue;
    if (field.inputType === "boolean" && typeof value !== "boolean") {
      errors.push({ field: field.key, message: "Expected boolean" });
    }
    if (field.inputType === "number" && typeof value !== "number") {
      errors.push({ field: field.key, message: "Expected number" });
    }
    if (
      (field.inputType === "string" || field.inputType === "select") &&
      typeof value !== "string"
    ) {
      errors.push({ field: field.key, message: "Expected string" });
    }
    if (
      field.options &&
      typeof value === "string" &&
      !field.options.includes(value)
    ) {
      errors.push({ field: field.key, message: "Unsupported option" });
    }
  }

  return { valid: errors.length === 0, errors };
}
