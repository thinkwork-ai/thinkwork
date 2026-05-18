// Helpers for the admin Templates listing page.
//
// The page composes two GraphQL queries:
//   - `agentTemplates(tenantId)` — strictly tenant-owned templates (any kind)
//   - `computerTemplates(tenantId)` — union of tenant-owned + platform-shipped
//     (tenant_id IS NULL) Computer templates
//
// `mergeTemplates` produces a deduped union, with the primary (tenant-owned)
// list taking precedence on id conflicts so the richer field set wins.
//
// `isPlatformTemplate` flags rows the caller doesn't own — those are
// effectively read-only at the API boundary (`updateAgentTemplate` rejects
// NULL-tenant rows via `requireTenantAdmin`). The UI surfaces a "Duplicate"
// action on those rows that clones into the current tenant via
// `createAgentTemplate`, after which the existing editor flow applies.

export interface TemplateLike {
  id: string;
  tenantId?: string | null;
}

export function mergeTemplates<T extends TemplateLike>(
  primary: readonly T[] | null | undefined,
  secondary: readonly T[] | null | undefined,
): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const t of primary ?? []) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  for (const t of secondary ?? []) {
    if (seen.has(t.id)) continue;
    seen.add(t.id);
    out.push(t);
  }
  return out;
}

export function isPlatformTemplate(t: {
  tenantId?: string | null;
}): boolean {
  return t.tenantId == null;
}

export function suggestedCloneSlug(originalSlug: string): string {
  return `${originalSlug}-copy`;
}

export function suggestedCloneName(originalName: string): string {
  return `${originalName} (Custom)`;
}
