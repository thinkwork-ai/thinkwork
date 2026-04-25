export interface TemplateBrowserConfig {
  enabled: true;
}

export type BrowserValidationResult =
  | { ok: true; value: TemplateBrowserConfig | null }
  | { ok: false; error: string };

export function validateTemplateBrowser(raw: unknown): BrowserValidationResult {
  if (raw === null || raw === undefined) return { ok: true, value: null };

  let value = raw;
  if (typeof raw === "string") {
    try {
      value = JSON.parse(raw);
    } catch {
      return { ok: false, error: "browser must be valid JSON" };
    }
  }

  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { ok: false, error: "browser must be an object or null" };
  }

  const config = value as Record<string, unknown>;
  const allowedKeys = new Set(["enabled"]);
  const unknownKeys = Object.keys(config).filter(
    (key) => !allowedKeys.has(key),
  );
  if (unknownKeys.length > 0) {
    return {
      ok: false,
      error: `browser has unsupported field(s): ${unknownKeys.join(", ")}`,
    };
  }

  if (config.enabled !== true) {
    return { ok: false, error: "browser.enabled must be true when present" };
  }

  return { ok: true, value: { enabled: true } };
}
