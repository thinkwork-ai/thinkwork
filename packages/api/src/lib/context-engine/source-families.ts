import type {
  ContextHit,
  ContextProviderDescriptor,
  ContextSourceFamily,
} from "./types.js";

type ProviderLike = Pick<
  ContextProviderDescriptor,
  "id" | "family" | "displayName" | "config" | "sourceFamily" | "subAgent"
>;

export function sourceFamilyForProvider(
  provider: ProviderLike,
): ContextSourceFamily {
  if (provider.sourceFamily) return provider.sourceFamily;
  if (provider.family === "memory") return "brain";
  if (provider.family === "wiki") return "pages";
  if (provider.family === "workspace") return "workspace";
  if (provider.family === "knowledge-base") return "knowledge-base";
  if (isWebProvider(provider)) return "web";
  if (provider.family === "mcp") return "mcp";
  return "source-agent";
}

export function sourceFamilyForHit(
  hit: ContextHit,
  provider?: ProviderLike,
): ContextSourceFamily {
  if (hit.sourceFamily) return hit.sourceFamily;
  return sourceFamilyForProvider({
    id: hit.providerId,
    family: hit.family,
    displayName: hit.provenance.label ?? provider?.displayName ?? hit.providerId,
    config: hit.metadata,
    sourceFamily: provider?.sourceFamily,
    subAgent: provider?.subAgent,
  });
}

function isWebProvider(provider: ProviderLike): boolean {
  const haystack = [
    provider.id,
    provider.displayName,
    provider.config,
    provider.subAgent?.promptRef,
    provider.subAgent?.toolAllowlist,
  ]
    .flatMap((value) => flattenUnknown(value))
    .join(" ")
    .toLowerCase();
  return /\bweb\b|web-search|web_search|browser-search|internet/.test(haystack);
}

function flattenUnknown(value: unknown): string[] {
  if (value == null) return [];
  if (typeof value === "string") return [value];
  if (typeof value === "number" || typeof value === "boolean") {
    return [String(value)];
  }
  if (Array.isArray(value)) return value.flatMap((entry) => flattenUnknown(entry));
  if (typeof value === "object") return Object.values(value).flatMap(flattenUnknown);
  return [];
}
