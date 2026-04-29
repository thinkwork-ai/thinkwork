export interface TemplateContextEngineConfig {
  enabled: true;
  providers?: {
    ids?: string[];
  };
  providerOptions?: {
    memory?: {
      queryMode?: "recall" | "reflect";
    };
  };
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
  const allowedKeys = new Set(["enabled", "providers", "providerOptions"]);
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

  const next: TemplateContextEngineConfig = { enabled: true };

  if (config.providers !== undefined) {
    if (
      !config.providers ||
      typeof config.providers !== "object" ||
      Array.isArray(config.providers)
    ) {
      return {
        ok: false,
        error: "contextEngine.providers must be an object",
      };
    }
    const providers = config.providers as Record<string, unknown>;
    const providerUnknownKeys = Object.keys(providers).filter(
      (key) => key !== "ids",
    );
    if (providerUnknownKeys.length > 0) {
      return {
        ok: false,
        error: `contextEngine.providers has unsupported field(s): ${providerUnknownKeys.join(", ")}`,
      };
    }
    if (providers.ids !== undefined) {
      if (
        !Array.isArray(providers.ids) ||
        providers.ids.some((id) => typeof id !== "string" || !id.trim())
      ) {
        return {
          ok: false,
          error: "contextEngine.providers.ids must be a string array",
        };
      }
      next.providers = { ids: [...new Set(providers.ids.map((id) => id.trim()))] };
    }
  }

  if (config.providerOptions !== undefined) {
    if (
      !config.providerOptions ||
      typeof config.providerOptions !== "object" ||
      Array.isArray(config.providerOptions)
    ) {
      return {
        ok: false,
        error: "contextEngine.providerOptions must be an object",
      };
    }
    const providerOptions = config.providerOptions as Record<string, unknown>;
    const optionUnknownKeys = Object.keys(providerOptions).filter(
      (key) => key !== "memory",
    );
    if (optionUnknownKeys.length > 0) {
      return {
        ok: false,
        error: `contextEngine.providerOptions has unsupported field(s): ${optionUnknownKeys.join(", ")}`,
      };
    }
    if (providerOptions.memory !== undefined) {
      if (
        !providerOptions.memory ||
        typeof providerOptions.memory !== "object" ||
        Array.isArray(providerOptions.memory)
      ) {
        return {
          ok: false,
          error: "contextEngine.providerOptions.memory must be an object",
        };
      }
      const memory = providerOptions.memory as Record<string, unknown>;
      const memoryUnknownKeys = Object.keys(memory).filter(
        (key) => key !== "queryMode",
      );
      if (memoryUnknownKeys.length > 0) {
        return {
          ok: false,
          error: `contextEngine.providerOptions.memory has unsupported field(s): ${memoryUnknownKeys.join(", ")}`,
        };
      }
      if (
        memory.queryMode !== undefined &&
        memory.queryMode !== "recall" &&
        memory.queryMode !== "reflect"
      ) {
        return {
          ok: false,
          error:
            "contextEngine.providerOptions.memory.queryMode must be recall or reflect",
        };
      }
      if (memory.queryMode) {
        next.providerOptions = {
          memory: { queryMode: memory.queryMode },
        };
      }
    }
  }

  return { ok: true, value: next };
}
