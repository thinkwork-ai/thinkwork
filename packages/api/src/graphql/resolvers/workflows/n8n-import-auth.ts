import { GraphQLError } from "graphql";
import { and, db, eq, tenantCredentials } from "../../utils.js";
import { readTenantCredentialSecret } from "../../../lib/tenant-credentials/secret-store.js";

export interface N8nImportAuth {
  apiKey?: string | null;
  bearerToken?: string | null;
  credentialSlug: string;
  configuredBaseUrl: string | null;
}

export async function loadN8nImportAuth(input: {
  tenantId: string;
  credentialSlug?: string | null;
  required?: boolean;
}): Promise<N8nImportAuth | null> {
  const slug = input.credentialSlug?.trim() || "n8n-api";
  const [credential] = await db
    .select()
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, input.tenantId),
        eq(tenantCredentials.slug, slug),
        eq(tenantCredentials.status, "active"),
      ),
    )
    .limit(1);

  if (!credential) {
    if (input.required) {
      throw new GraphQLError(`n8n credential '${slug}' was not found`, {
        extensions: { code: "BAD_USER_INPUT" },
      });
    }
    return null;
  }

  if (credential.kind !== "api_key" && credential.kind !== "bearer_token") {
    throw new GraphQLError(
      `n8n credential '${slug}' must be an api_key or bearer_token credential.`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }

  const secret = await readTenantCredentialSecret(credential.secret_ref);
  const configuredBaseUrl = configuredN8nBaseUrl(credential.metadata_json);
  if (credential.kind === "api_key") {
    return {
      apiKey: stringSecret(secret.apiKey, "apiKey", slug),
      credentialSlug: slug,
      configuredBaseUrl,
    };
  }
  return {
    bearerToken: stringSecret(secret.token, "token", slug),
    credentialSlug: slug,
    configuredBaseUrl,
  };
}

export function requireConfiguredN8nBaseUrl(auth: N8nImportAuth): string {
  if (auth.configuredBaseUrl) return auth.configuredBaseUrl;
  throw new GraphQLError(
    `n8n credential '${auth.credentialSlug}' must configure metadata_json.n8nBaseUrl before workflow draft import.`,
    { extensions: { code: "BAD_USER_INPUT" } },
  );
}

function configuredN8nBaseUrl(metadata: unknown): string | null {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const value = record.n8nBaseUrl ?? record.baseUrl ?? record.publicUrl;
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function stringSecret(value: unknown, field: string, slug: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new GraphQLError(
    `n8n credential '${slug}' is missing secret field '${field}'.`,
    { extensions: { code: "BAD_USER_INPUT" } },
  );
}
