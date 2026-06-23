import { GraphQLError } from "graphql";
import { and, eq } from "drizzle-orm";
import { getConfig } from "@thinkwork/runtime-config";
import {
  authProviderResources,
  pluginComponents,
  pluginInstalls,
  tenantAuthProviderReferences,
} from "@thinkwork/database-pg/schema";
import { db as defaultDb } from "../../../lib/db.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "../../../lib/plugins/secrets.js";
import type { PluginInstallRow } from "../../../lib/plugins/store.js";

type DbLike = typeof defaultDb;
type DbTransactionLike = Parameters<Parameters<DbLike["transaction"]>[0]>[0];
type QueryDbLike = DbLike | DbTransactionLike;

const WORKOS_PLUGIN_KEY = "workos-auth";
const WORKOS_PROVIDER_KEY = "workos";
const WORKOS_COMPONENT_KEY = "workos-auth";
const WORKOS_IDP_NAME = "WorkOSAuth";
const WORKOS_PUBLIC_OPTIONS = [
  {
    key: "sso",
    displayName: "Continue with SSO",
    providerSpecific: false,
    recommended: true,
  },
];

export interface ConfigureWorkosAuthInput {
  tenantId: string;
  installId: string;
  issuerUrl: string;
  clientId: string;
  clientSecret?: string | null;
  publicOptionLabel?: string | null;
}

export interface ConfigureWorkosAuthDeps {
  db: DbLike;
  secrets: PluginSecretsClient;
  stage(): string;
  apiBaseUrl(): string;
  webOrigins(): string[];
  cognitoUserPoolId(): string;
  cognitoAppClientIds(): string[];
  now(): Date;
}

export function createDefaultConfigureWorkosAuthDeps(): ConfigureWorkosAuthDeps {
  return {
    db: defaultDb,
    secrets: createSecretsManagerPluginSecrets(),
    stage: () => getConfig("STAGE") || process.env.STAGE || "unknown",
    apiBaseUrl: () => requiredConfigUrl("THINKWORK_API_URL"),
    webOrigins: () =>
      [getConfig("WWW_URL"), getConfig("ADMIN_URL")]
        .map((value) => safeOrigin(value))
        .filter((value): value is string => Boolean(value)),
    cognitoUserPoolId: () => requiredConfig("COGNITO_USER_POOL_ID"),
    cognitoAppClientIds: () =>
      (getConfig("COGNITO_APP_CLIENT_IDS") || "")
        .split(",")
        .map((value) => value.trim())
        .filter(Boolean),
    now: () => new Date(),
  };
}

export async function configureWorkosAuthPluginForTenant(
  input: ConfigureWorkosAuthInput,
  deps: ConfigureWorkosAuthDeps = createDefaultConfigureWorkosAuthDeps(),
) {
  const issuerUrl = normalizeIssuerUrl(input.issuerUrl);
  const clientId = normalizeClientId(input.clientId);
  const publicOptionLabel =
    safePublicLabel(input.publicOptionLabel) || "Continue with SSO";
  const apiHost = hostnameForBaseUrl(deps.apiBaseUrl());
  const allowedRedirectOrigins = deps.webOrigins();
  const userPoolId = deps.cognitoUserPoolId();
  const appClientIds = deps.cognitoAppClientIds();
  const now = deps.now();

  if (appClientIds.length === 0) {
    throw new GraphQLError("Cognito app clients are not configured", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const existing = await findExistingWorkosConfig(deps.db, {
    tenantId: input.tenantId,
    installId: input.installId,
  });
  const clientSecret = input.clientSecret?.trim() ?? "";
  if (!existing && !clientSecret) {
    throw new GraphQLError("WorkOS client secret is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const secretRef =
    existing?.resource.client_secret_ref ??
    workosSecretRef({
      stage: deps.stage(),
      tenantId: input.tenantId,
      installId: input.installId,
    });
  if (clientSecret) {
    await deps.secrets.putSecret(
      secretRef,
      JSON.stringify({ client_secret: clientSecret }),
    );
  }

  return deps.db.transaction(async (tx) => {
    const install = await loadWorkosInstall(tx, input.tenantId, input.installId);

    const [resource] = existing?.resource
      ? await tx
          .update(authProviderResources)
          .set({
            display_name: "WorkOS Auth",
            cognito_user_pool_id: userPoolId,
            cognito_app_client_ids: appClientIds,
            cognito_identity_provider_name: WORKOS_IDP_NAME,
            issuer_url: issuerUrl,
            client_id: clientId,
            client_secret_ref: secretRef,
            authorize_scopes: "openid email profile",
            public_option_mode: "single_sso",
            provider_options: WORKOS_PUBLIC_OPTIONS,
            validation_status: "valid",
            public_options_published: true,
            last_validated_at: now,
            last_error_code: null,
            diagnostics: {},
            updated_at: now,
          })
          .where(eq(authProviderResources.id, existing.resource.id))
          .returning()
      : await tx
          .insert(authProviderResources)
          .values({
            provider_key: WORKOS_PROVIDER_KEY,
            display_name: "WorkOS Auth",
            cognito_user_pool_id: userPoolId,
            cognito_app_client_ids: appClientIds,
            cognito_identity_provider_name: WORKOS_IDP_NAME,
            issuer_url: issuerUrl,
            client_id: clientId,
            client_secret_ref: secretRef,
            authorize_scopes: "openid email profile",
            public_option_mode: "single_sso",
            provider_options: WORKOS_PUBLIC_OPTIONS,
            validation_status: "valid",
            public_options_published: true,
            last_validated_at: now,
            diagnostics: {},
          })
          .returning();
    if (!resource) throw new Error("WorkOS auth resource upsert returned no row");

    const metadata = {
      allowedRedirectOrigins,
      configuredVia: "plugin-detail",
    };
    const [reference] = existing?.reference
      ? await tx
          .update(tenantAuthProviderReferences)
          .set({
            status: "enabled",
            hostnames: [apiHost],
            public_option_label: publicOptionLabel,
            enabled_at: existing.reference.enabled_at ?? now,
            disabled_at: null,
            last_error_code: null,
            metadata,
            updated_at: now,
          })
          .where(eq(tenantAuthProviderReferences.id, existing.reference.id))
          .returning()
      : await tx
          .insert(tenantAuthProviderReferences)
          .values({
            tenant_id: input.tenantId,
            plugin_install_id: input.installId,
            auth_provider_resource_id: resource.id,
            status: "enabled",
            hostnames: [apiHost],
            public_option_label: publicOptionLabel,
            enabled_at: now,
            metadata,
          })
          .returning();
    if (!reference) {
      throw new Error("WorkOS tenant auth reference upsert returned no row");
    }

    const handlerRef = workosHandlerRef({
      issuerUrl,
      clientId,
      resourceId: resource.id,
      referenceId: reference.id,
      publicOptionLabel,
      now,
    });
    await tx
      .update(pluginComponents)
      .set({
        state: "provisioned",
        handler_ref: handlerRef,
        last_error: null,
        updated_at: now,
      })
      .where(
        and(
          eq(pluginComponents.plugin_install_id, input.installId),
          eq(pluginComponents.component_key, WORKOS_COMPONENT_KEY),
          eq(pluginComponents.component_type, "auth-provider"),
        ),
      );

    await tx
      .update(pluginInstalls)
      .set({
        state:
          install.state === "failed" ? "partially_installed" : install.state,
        last_error: null,
        updated_at: now,
      })
      .where(eq(pluginInstalls.id, input.installId));

    const updatedInstall = await loadWorkosInstall(
      tx,
      input.tenantId,
      input.installId,
    );
    return { install: updatedInstall, resource, reference };
  });
}

async function loadWorkosInstall(
  db: QueryDbLike,
  tenantId: string,
  installId: string,
): Promise<PluginInstallRow> {
  const [install] = await db
    .select()
    .from(pluginInstalls)
    .where(
      and(
        eq(pluginInstalls.id, installId),
        eq(pluginInstalls.tenant_id, tenantId),
        eq(pluginInstalls.plugin_key, WORKOS_PLUGIN_KEY),
      ),
    )
    .limit(1);
  if (!install) {
    throw new GraphQLError("WorkOS Auth plugin install not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return install;
}

async function findExistingWorkosConfig(
  db: QueryDbLike,
  args: { tenantId: string; installId: string },
) {
  const [row] = await db
    .select({
      resource: authProviderResources,
      reference: tenantAuthProviderReferences,
    })
    .from(tenantAuthProviderReferences)
    .innerJoin(
      authProviderResources,
      eq(
        tenantAuthProviderReferences.auth_provider_resource_id,
        authProviderResources.id,
      ),
    )
    .where(
      and(
        eq(tenantAuthProviderReferences.tenant_id, args.tenantId),
        eq(tenantAuthProviderReferences.plugin_install_id, args.installId),
        eq(authProviderResources.provider_key, WORKOS_PROVIDER_KEY),
      ),
    )
    .limit(1);
  return row ?? null;
}

function workosHandlerRef(args: {
  issuerUrl: string;
  clientId: string;
  resourceId: string;
  referenceId: string;
  publicOptionLabel: string;
  now: Date;
}) {
  return {
    status: "valid",
    provider: WORKOS_PROVIDER_KEY,
    cognitoIdentityProviderName: WORKOS_IDP_NAME,
    issuerUrl: args.issuerUrl,
    issuerHost: new URL(args.issuerUrl).hostname,
    clientId: args.clientId,
    authProviderResourceId: args.resourceId,
    tenantAuthProviderReferenceId: args.referenceId,
    publicOptionsPublished: true,
    publicOptionLabel: args.publicOptionLabel,
    providerOptions: WORKOS_PUBLIC_OPTIONS,
    lastValidatedAt: args.now.toISOString(),
    diagnosticCode: null,
  };
}

function normalizeIssuerUrl(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GraphQLError("WorkOS issuer URL is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new GraphQLError("WorkOS issuer URL is invalid", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (url.protocol !== "https:") {
    throw new GraphQLError("WorkOS issuer URL must use https", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  url.hash = "";
  url.search = "";
  return url.toString().replace(/\/$/, "");
}

function normalizeClientId(value: string): string {
  const trimmed = value.trim();
  if (!trimmed) {
    throw new GraphQLError("WorkOS client ID is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  if (!/^client_[A-Za-z0-9._-]+$/.test(trimmed)) {
    throw new GraphQLError("WorkOS client ID must start with client_", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  return trimmed;
}

function safePublicLabel(value: string | null | undefined): string {
  return typeof value === "string" ? value.trim().slice(0, 80) : "";
}

function requiredConfig(key: string): string {
  const value = getConfig(key)?.trim();
  if (!value) {
    throw new GraphQLError(`${key} is not configured`, {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  return value;
}

function requiredConfigUrl(key: string): string {
  const value = requiredConfig(key);
  try {
    return new URL(value).toString().replace(/\/$/, "");
  } catch {
    throw new GraphQLError(`${key} is not a valid URL`, {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
}

function hostnameForBaseUrl(value: string): string {
  return new URL(value).host.toLowerCase();
}

function safeOrigin(value: string | null | undefined): string | null {
  if (!value) return null;
  try {
    return new URL(value).origin;
  } catch {
    return null;
  }
}

function workosSecretRef(args: {
  stage: string;
  tenantId: string;
  installId: string;
}): string {
  const stage = args.stage.replace(/[^A-Za-z0-9_.-]/g, "-") || "unknown";
  return [
    "thinkwork",
    stage,
    "plugin-auth",
    args.tenantId,
    args.installId,
    "workos-client-secret",
  ].join("/");
}

export function authProviderResourcePayload(
  row: typeof authProviderResources.$inferSelect,
) {
  return {
    id: row.id,
    providerKey: row.provider_key,
    displayName: row.display_name,
    cognitoUserPoolId: row.cognito_user_pool_id,
    cognitoAppClientIds: row.cognito_app_client_ids,
    cognitoIdentityProviderName: row.cognito_identity_provider_name,
    issuerUrl: row.issuer_url,
    clientId: row.client_id,
    clientSecretConfigured: Boolean(row.client_secret_ref),
    authorizeScopes: row.authorize_scopes,
    publicOptionMode: row.public_option_mode,
    providerOptions: row.provider_options,
    validationStatus: row.validation_status,
    publicOptionsPublished: row.public_options_published,
    lastValidatedAt: row.last_validated_at,
    lastErrorCode: row.last_error_code,
    diagnostics: row.diagnostics,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function tenantAuthProviderReferencePayload(
  row: typeof tenantAuthProviderReferences.$inferSelect,
  resource: typeof authProviderResources.$inferSelect,
) {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    pluginInstallId: row.plugin_install_id,
    authProviderResourceId: row.auth_provider_resource_id,
    status: row.status,
    hostnames: row.hostnames,
    publicOptionLabel: row.public_option_label,
    enabledAt: row.enabled_at,
    disabledAt: row.disabled_at,
    lastErrorCode: row.last_error_code,
    metadata: row.metadata,
    resource: authProviderResourcePayload(resource),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}
