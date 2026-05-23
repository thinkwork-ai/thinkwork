export const TENANT_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,28}[a-z0-9]$/;

export const RESERVED_TENANT_SLUGS = [
  "admin",
  "agents",
  "api",
  "app",
  "assets",
  "cdn",
  "dev",
  "docs",
  "mail",
  "mobile",
  "prod",
  "staging",
  "test",
  "www",
] as const;

const RESERVED_TENANT_SLUG_SET = new Set<string>(RESERVED_TENANT_SLUGS);

export function isReservedTenantSlug(slug: string): boolean {
  return RESERVED_TENANT_SLUG_SET.has(slug);
}
