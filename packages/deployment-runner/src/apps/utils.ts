export function requireDigestImage(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
  label: string,
): string {
  const value = optionalString(desiredConfig, key);
  if (!value) {
    throw new Error(`${label} is required`);
  }
  if (!/@sha256:[0-9a-f]{64}$/i.test(value)) {
    throw new Error(`${label} must be pinned to an immutable sha256 digest`);
  }
  return value;
}

export function requireStringInput(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
  label: string,
): string {
  const value = optionalString(desiredConfig, key);
  if (!value) {
    throw new Error(`${label} is required`);
  }
  return value;
}

export function optionalString(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
): string | undefined {
  const value = desiredConfig?.[key];
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

export function optionalNumber(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
): number | undefined {
  const value = desiredConfig?.[key];
  return typeof value === "number" && Number.isFinite(value)
    ? value
    : undefined;
}

export function optionalStringArray(
  desiredConfig: Record<string, unknown> | undefined,
  key: string,
): string[] | undefined {
  const value = desiredConfig?.[key];
  if (!Array.isArray(value)) return undefined;
  const entries = value.filter(
    (entry): entry is string =>
      typeof entry === "string" && entry.trim() !== "",
  );
  return entries.length ? entries : undefined;
}

export function terraformOutputsValue(
  terraformOutputs: Record<string, unknown>,
  key: string,
): unknown {
  const entry = terraformOutputs[key];
  if (
    entry &&
    typeof entry === "object" &&
    Object.prototype.hasOwnProperty.call(entry, "value")
  ) {
    return (entry as { value?: unknown }).value;
  }
  return entry;
}

export function boolOutput(
  terraformOutputs: Record<string, unknown>,
  key: string,
): boolean {
  const value = terraformOutputsValue(terraformOutputs, key);
  return value === true || value === "true" || value === "1";
}

export function stringOutput(
  terraformOutputs: Record<string, unknown>,
  key: string,
): string | null {
  const value = terraformOutputsValue(terraformOutputs, key);
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
