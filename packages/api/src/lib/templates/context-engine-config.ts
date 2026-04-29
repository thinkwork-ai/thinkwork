export interface TemplateContextEngineConfig {
  enabled: true;
}

export type ContextEngineValidationResult =
  | { ok: true; value: TemplateContextEngineConfig | null }
  | { ok: false; error: string };

export function validateTemplateContextEngine(
  raw: unknown,
): ContextEngineValidationResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "contextEngine must be valid JSON" };
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "contextEngine must be an object or null" };
  }

  const config = value as Record<string, unknown>;
  const allowedKeys = new Set(["enabled"]);
  const unknownKeys = Object.keys(config).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `contextEngine has unsupported field(s): ${unknownKeys.join(", ")}`,
    };
  }

  if (config.enabled !== true) {
    return {
      ok: false,
      error: "contextEngine.enabled must be true when present",
    };
  }

  return { ok: true, value: { enabled: true } };
}
