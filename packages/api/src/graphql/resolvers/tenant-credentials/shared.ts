import { GraphQLError } from "graphql";
import {
  and,
  db,
  eq,
  snakeToCamel,
  tenantCredentials,
} from "../../utils.js";
import type {
  TenantCredentialKind,
  TenantCredentialStatus,
} from "../../../lib/tenant-credentials/secret-store.js";

export interface TenantCredentialRow {
  id: string;
  tenant_id: string;
  display_name: string;
  slug: string;
  kind: TenantCredentialKind;
  status: TenantCredentialStatus;
  secret_ref: string;
  eventbridge_connection_arn: string | null;
  schema_json: unknown;
  metadata_json: unknown;
  last_used_at: Date | null;
  last_validated_at: Date | null;
  created_by_user_id: string | null;
  deleted_at: Date | null;
  created_at: Date;
  updated_at: Date;
}

export function credentialToGraphql(row: Record<string, unknown>): unknown {
  const safe = { ...row };
  delete safe.secret_ref;
  return snakeToCamel(safe);
}

export async function loadTenantCredentialForMutation(
  id: string,
): Promise<TenantCredentialRow> {
  const [row] = await db
    .select()
    .from(tenantCredentials)
    .where(eq(tenantCredentials.id, id))
    .limit(1);
  if (!row) {
    throw new GraphQLError("Tenant credential not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return row as TenantCredentialRow;
}

export function slugFromDisplayName(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 80);
  return slug || "credential";
}

export function normalizeSlug(value: string): string {
  const slug = slugFromDisplayName(value);
  if (!/^[a-z0-9][a-z0-9-]{0,79}$/.test(slug)) {
    throw new GraphQLError(
      "Credential slug must contain lowercase letters, numbers, and hyphens",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  return slug;
}

export function assertKnownKind(kind: string): asserts kind is TenantCredentialKind {
  if (
    kind !== "api_key" &&
    kind !== "bearer_token" &&
    kind !== "basic_auth" &&
    kind !== "soap_partner" &&
    kind !== "webhook_signing_secret" &&
    kind !== "json"
  ) {
    throw new GraphQLError(`Unsupported credential kind: ${kind}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export function assertKnownStatus(
  status: string,
): asserts status is TenantCredentialStatus {
  if (status !== "active" && status !== "disabled" && status !== "deleted") {
    throw new GraphQLError(`Unsupported credential status: ${status}`, {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}

export async function assertSlugAvailable(input: {
  tenantId: string;
  slug: string;
  exceptId?: string;
}): Promise<void> {
  const rows = await db
    .select({ id: tenantCredentials.id })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, input.tenantId),
        eq(tenantCredentials.slug, input.slug),
      ),
    )
    .limit(1);
  const existing = rows[0];
  if (existing && existing.id !== input.exceptId) {
    throw new GraphQLError("A credential with this slug already exists", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
}
