/**
 * Tenant skill catalog storage contract.
 *
 * Catalog packages live at:
 *   tenants/<tenantSlug>/skill-catalog/<slug>/
 *
 * Each package is a folder-shaped skill:
 *   SKILL.md
 *   WIRING.md
 *   scripts/...
 *   references/...
 *
 * Installing a catalog skill copies that package into a workspace scope at
 * skills/<slug>/ and writes skills/<slug>/.catalog-ref.json. The ref stores the
 * exact CONTEXT.md snippet that was appended so uninstall can remove it by
 * byte-for-byte match instead of guessing from the slug.
 */

const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
const ARCHIVE_SLUG_RE = /^[a-z0-9](?:[a-z0-9]|-(?=[a-z0-9])){0,63}$/;
const SHA256_HEX_RE = /^[0-9a-f]{64}$/;

export type CatalogRef = {
  slug: string;
  source_sha256: string;
  installed_at: string;
  wiring_choice: string;
  snippet: string;
};

export type WiringSuggestion = {
  id: string;
  title: string;
  description: string;
  snippet: string;
};

export type CatalogSkillManifest = {
  slug: string;
  sha256: string;
  has_skill_md: boolean;
  has_wiring_md: boolean;
  suggestions: WiringSuggestion[];
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

function isIsoDateString(value: unknown): value is string {
  return (
    typeof value === "string" &&
    value.length > 0 &&
    !Number.isNaN(Date.parse(value))
  );
}

export function isCatalogSlug(value: unknown): value is string {
  return typeof value === "string" && SLUG_RE.test(value);
}

/**
 * Agent Skills archive imports use the public spec's stricter skill-name
 * grammar. Keep this separate from `isCatalogSlug`: existing ThinkWork catalog
 * slugs include legacy/plugin namespaces such as `lastmile--crm-basics`.
 */
export function isCatalogArchiveSlug(value: unknown): value is string {
  return typeof value === "string" && ARCHIVE_SLUG_RE.test(value);
}

export function isSha256Hex(value: unknown): value is string {
  return typeof value === "string" && SHA256_HEX_RE.test(value);
}

export function isWiringSuggestion(value: unknown): value is WiringSuggestion {
  return (
    isRecord(value) &&
    isCatalogSlug(value.id) &&
    isNonEmptyString(value.title) &&
    typeof value.description === "string" &&
    typeof value.snippet === "string"
  );
}

export function isCatalogRef(value: unknown): value is CatalogRef {
  return (
    isRecord(value) &&
    isCatalogSlug(value.slug) &&
    isSha256Hex(value.source_sha256) &&
    isIsoDateString(value.installed_at) &&
    isCatalogSlug(value.wiring_choice) &&
    typeof value.snippet === "string"
  );
}

export function isCatalogSkillManifest(
  value: unknown,
): value is CatalogSkillManifest {
  return (
    isRecord(value) &&
    isCatalogSlug(value.slug) &&
    isSha256Hex(value.sha256) &&
    typeof value.has_skill_md === "boolean" &&
    typeof value.has_wiring_md === "boolean" &&
    Array.isArray(value.suggestions) &&
    value.suggestions.every(isWiringSuggestion)
  );
}
