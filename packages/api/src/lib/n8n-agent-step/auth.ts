import { createHash, timingSafeEqual } from "node:crypto";
import { and, eq } from "drizzle-orm";
import {
  managedApplications,
  pluginInstalls,
  tenants,
} from "@thinkwork/database-pg/schema";
import { N8N_AGENT_STEP_BRIDGE_CREDENTIAL_SECRET_JSON_KEY } from "@thinkwork/plugin-n8n/manifest";
import { db as defaultDb } from "../db.js";
import {
  createSecretsManagerPluginSecrets,
  type PluginSecretsClient,
} from "../plugins/secrets.js";

type DbLike = typeof defaultDb;

export class N8nAgentStepAuthError extends Error {
  readonly statusCode = 401;

  constructor(message = "Unauthorized") {
    super(message);
    this.name = "N8nAgentStepAuthError";
  }
}

export interface N8nAgentStepAuthContext {
  tenantId: string;
  tenantSlug: string;
  pluginInstallId: string;
  managedApplicationId: string;
  bridgeCredentialSecretRef: string;
  n8nPublicUrl: string | null;
}

export interface AuthenticateN8nAgentStepBridgeDeps {
  db?: DbLike;
  secrets?: PluginSecretsClient;
}

export async function authenticateN8nAgentStepBridgeRequest(
  headers: Record<string, string | undefined>,
  deps: AuthenticateN8nAgentStepBridgeDeps = {},
): Promise<N8nAgentStepAuthContext> {
  const lowerHeaders = lowerCaseHeaders(headers);
  const token = extractBearerToken(lowerHeaders.authorization);
  const tenantRef =
    lowerHeaders["x-tenant-id"]?.trim() ??
    lowerHeaders["x-thinkwork-tenant-id"]?.trim() ??
    lowerHeaders["x-tenant-slug"]?.trim() ??
    lowerHeaders["x-thinkwork-tenant-slug"]?.trim();
  if (!token || !tenantRef) {
    throw new N8nAgentStepAuthError();
  }

  const db = deps.db ?? defaultDb;
  const tenant = await findTenant(db, tenantRef);
  if (!tenant) throw new N8nAgentStepAuthError();

  const [install] = await db
    .select({
      id: pluginInstalls.id,
      state: pluginInstalls.state,
    })
    .from(pluginInstalls)
    .where(
      and(
        eq(pluginInstalls.tenant_id, tenant.id),
        eq(pluginInstalls.plugin_key, "n8n"),
      ),
    )
    .limit(1);
  if (
    !install ||
    (install.state !== "installed" && install.state !== "partially_installed")
  ) {
    throw new N8nAgentStepAuthError();
  }

  const [app] = await db
    .select({
      id: managedApplications.id,
      desiredStatus: managedApplications.desired_status,
      desiredConfig: managedApplications.desired_config,
    })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenant.id),
        eq(managedApplications.key, "n8n"),
      ),
    )
    .limit(1);
  const desiredConfig = recordValue(app?.desiredConfig);
  const secretRef = stringValue(
    desiredConfig.agentStepBridgeCredentialSecretArn,
  );
  const n8nPublicUrl = stringValue(desiredConfig.publicUrl);
  if (!app || app.desiredStatus === "disabled" || !secretRef) {
    throw new N8nAgentStepAuthError();
  }

  const secrets = deps.secrets ?? createSecretsManagerPluginSecrets();
  const secretString = await secrets.getSecret(secretRef);
  const expectedToken = extractBridgeCredential(secretString);
  if (!expectedToken || !safeTokenEqual(token, expectedToken)) {
    throw new N8nAgentStepAuthError();
  }

  return {
    tenantId: tenant.id,
    tenantSlug: tenant.slug,
    pluginInstallId: install.id,
    managedApplicationId: app.id,
    bridgeCredentialSecretRef: secretRef,
    n8nPublicUrl,
  };
}

export function extractBearerToken(value: string | undefined): string | null {
  if (!value) return null;
  const match = value.match(/^Bearer\s+(.+)$/i);
  return match?.[1]?.trim() || null;
}

export function extractBridgeCredential(
  secretString: string | null,
): string | null {
  const trimmed = secretString?.trim();
  if (!trimmed) return null;
  try {
    const parsed = JSON.parse(trimmed) as unknown;
    if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
      const value = (parsed as Record<string, unknown>)[
        N8N_AGENT_STEP_BRIDGE_CREDENTIAL_SECRET_JSON_KEY
      ];
      return typeof value === "string" && value.trim() ? value.trim() : null;
    }
  } catch {
    return trimmed;
  }
  return null;
}

async function findTenant(db: DbLike, tenantRef: string) {
  if (looksLikeUuid(tenantRef)) {
    const [tenant] = await db
      .select({ id: tenants.id, slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, tenantRef))
      .limit(1);
    return tenant ?? null;
  }
  const [tenant] = await db
    .select({ id: tenants.id, slug: tenants.slug })
    .from(tenants)
    .where(eq(tenants.slug, tenantRef))
    .limit(1);
  return tenant ?? null;
}

function lowerCaseHeaders(
  headers: Record<string, string | undefined>,
): Record<string, string> {
  return Object.fromEntries(
    Object.entries(headers)
      .filter(([, value]) => typeof value === "string")
      .map(([key, value]) => [key.toLowerCase(), value as string]),
  );
}

function safeTokenEqual(actual: string, expected: string): boolean {
  const actualDigest = createHash("sha256").update(actual).digest();
  const expectedDigest = createHash("sha256").update(expected).digest();
  return timingSafeEqual(actualDigest, expectedDigest);
}

function looksLikeUuid(value: string): boolean {
  return /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
    value,
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
