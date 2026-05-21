import { isBuiltinToolSlug } from "../../../lib/builtin-tool-slugs.js";

function asPolicy(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? { ...(value as Record<string, unknown>) }
    : {};
}

function stringArray(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter(Boolean);
}

export function builtInToolsFromPolicy(value: unknown): string[] {
  const policy = asPolicy(value);
  const configured = stringArray(policy.builtInTools);
  const fallback =
    configured.length > 0 ? configured : stringArray(policy.allowedTools);
  return Array.from(new Set(fallback.filter(isBuiltinToolSlug))).sort();
}

export function normalizeBuiltInToolSlugs(slugs: string[]): string[] {
  const normalized = Array.from(
    new Set(slugs.map((slug) => slug.trim()).filter(Boolean)),
  ).sort();
  const unknownSlug = normalized.find((slug) => !isBuiltinToolSlug(slug));
  if (unknownSlug) {
    throw new Error(`Unknown built-in tool '${unknownSlug}'`);
  }
  return normalized;
}

export function withBuiltInToolPolicy(
  value: unknown,
  builtInToolSlugs: string[],
): Record<string, unknown> {
  return {
    ...asPolicy(value),
    builtInTools: builtInToolSlugs,
    allowedTools: builtInToolSlugs,
  };
}

export function withMcpServerPolicy(
  value: unknown,
  mcpServerSlugs: string[],
): Record<string, unknown> {
  return {
    ...asPolicy(value),
    allowedServers: mcpServerSlugs,
  };
}
