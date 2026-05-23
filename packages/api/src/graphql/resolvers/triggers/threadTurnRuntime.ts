function asObject(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : null;
}

function normalizeRuntimeType(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function runtimeFromJson(value: unknown): string | null {
  const obj = asObject(value);
  if (!obj) return null;

  const direct = normalizeRuntimeType(obj.runtimeType ?? obj.runtime_type ?? obj.runtime);
  if (direct) return direct;

  const response = asObject(obj.response);
  return normalizeRuntimeType(
    response?.runtimeType ?? response?.runtime_type ?? response?.runtime,
  );
}

export function runtimeTypeFromTurn(row: Record<string, unknown>): string | null {
  return (
    normalizeRuntimeType(row.runtimeType ?? row.runtime_type) ??
    runtimeFromJson(row.contextSnapshot ?? row.context_snapshot) ??
    runtimeFromJson(row.resultJson ?? row.result_json) ??
    runtimeFromJson(row.usageJson ?? row.usage_json)
  );
}

export function withRuntimeType<T extends Record<string, unknown>>(
  row: T,
): T & { runtimeType: string | null } {
  return {
    ...row,
    runtimeType: runtimeTypeFromTurn(row),
  };
}
