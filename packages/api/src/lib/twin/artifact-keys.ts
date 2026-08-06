/**
 * Brain-artifacts S3 key derivation (THINK-625).
 *
 * Every per-tenant document the Brain reads is filed under the SAME tenant
 * scope segment, because the Brain locates them all from one resolved
 * keyspace: if `twin-mcp-keys/<X>/latest.json` and
 * `user-claims/<X>/latest.json` ever disagreed about `<X>`, a tenant's keys
 * would authenticate against claims that belong to nobody and every user
 * would silently read as "no entry". One helper, one drift surface.
 *
 * The scope segment is the tenant UUID verbatim today — this exists so the
 * two callers cannot diverge if that ever stops being true.
 */

/** The per-tenant path segment shared by every brain-artifacts document. */
export function twinArtifactTenantScope(tenantId: string): string {
  return tenantId;
}

/** Hashed `tkt_` key manifest — `twin-mcp-keys/<tenantId>/latest.json`. */
export function twinKeyManifestKey(tenantId: string): string {
  return `twin-mcp-keys/${twinArtifactTenantScope(tenantId)}/latest.json`;
}

/** Per-user claims manifest — `user-claims/<tenantId>/latest.json`. */
export function userClaimsManifestKey(tenantId: string): string {
  return `user-claims/${twinArtifactTenantScope(tenantId)}/latest.json`;
}
