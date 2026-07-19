import { createHash } from "node:crypto";

const ACCOUNT_ID_RE = /^\d{12}$/;
const REGION_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d$/;
const USER_POOL_ID_RE = /^[a-z]{2}(?:-gov)?-[a-z]+-\d_[A-Za-z0-9]+$/;
const APP_CLIENT_ID_RE = /^[a-z0-9]{20,128}$/;
const CONNECTION_KEY_RE = /^[a-z0-9][a-z0-9:_-]{1,127}$/;
const PROVIDER_NAME_RE = /^[\w][\w .-]{0,127}$/;
const STAGE_RE = /^[a-z0-9][a-z0-9-]{0,31}$/;
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const MICROSOFT_TENANT_ISSUER_RE = new RegExp(
  `^https://login\\.microsoftonline\\.com/(${UUID_RE.source.slice(1, -1)})/v2\\.0/?$`,
  "i",
);
const SHA256_RE = /^[a-f0-9]{64}$/;

const CONNECTION_KINDS = new Set([
  "local",
  "google",
  "microsoft_organizations",
  "microsoft_tenant",
]);
const LIFECYCLE_STATES = new Set(["native", "denied"]);
const CLIENT_FAMILIES = new Set(["web", "mobile", "desktop", "cli"]);

export interface SafeAuthConnectionMetadata {
  connectionKey: string;
  providerKey: string;
  providerKind: string;
  displayName: string;
  lifecycleState: "native" | "denied";
  cognitoUserPoolId: string;
  cognitoIdentityProviderName: string;
  issuerUrl?: string;
  clientId?: string;
  clientSecretRef?: string;
  resourceArn?: string;
  authorizeScopes: string;
  tenantBindings: Array<{
    tenantId: string;
    label: string;
    hostnames: string[];
    status: "disabled" | "enabled" | "invalid" | "decommissioning";
  }>;
}

export interface SafeAuthRouteClientMetadata {
  routeKey: string;
  clientFamily: "web" | "mobile" | "desktop" | "cli";
  cognitoUserPoolId: string;
  cognitoAppClientId: string;
  providerNames: string[];
  explicitAuthFlows: string[];
  redirectUris: string[];
  logoutUris: string[];
  lifecycleState: "native" | "denied";
  resourceArn?: string;
}

export interface SafeAuthReconcilePayload {
  stage: string;
  awsAccountId: string;
  awsRegion: string;
  revision: number;
  expectedPreviousRevision: number;
  idempotencyKey: string;
  manifestFingerprint: string;
  connections: SafeAuthConnectionMetadata[];
  routeClients: SafeAuthRouteClientMetadata[];
}

export class AuthProviderValidationError extends Error {
  constructor(
    public readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = "AuthProviderValidationError";
  }
}

function object(value: unknown, path: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    throw new AuthProviderValidationError(
      "invalid_shape",
      `${path} must be an object`,
    );
  }
  return value as Record<string, unknown>;
}

function string(value: unknown, path: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new AuthProviderValidationError(
      "invalid_string",
      `${path} must be a non-empty string`,
    );
  }
  return value.trim();
}

function stringArray(value: unknown, path: string): string[] {
  if (!Array.isArray(value)) {
    throw new AuthProviderValidationError(
      "invalid_shape",
      `${path} must be an array`,
    );
  }
  const result = value.map((entry, index) =>
    string(entry, `${path}[${index}]`),
  );
  if (new Set(result).size !== result.length) {
    throw new AuthProviderValidationError(
      "duplicate_value",
      `${path} contains duplicates`,
    );
  }
  return result;
}

function assertOnlyKeys(
  value: Record<string, unknown>,
  allowed: readonly string[],
  path: string,
): void {
  const unknown = Object.keys(value).filter((key) => !allowed.includes(key));
  if (unknown.length > 0) {
    throw new AuthProviderValidationError(
      "unknown_field",
      `${path} contains unsupported fields: ${unknown.sort().join(", ")}`,
    );
  }
}

function optionalString(value: unknown, path: string): string | undefined {
  return value === undefined || value === null
    ? undefined
    : string(value, path);
}

function validateUrl(value: string, path: string, httpsOnly = true): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthProviderValidationError(
      "invalid_url",
      `${path} must be an absolute URL`,
    );
  }
  if (httpsOnly && parsed.protocol !== "https:") {
    throw new AuthProviderValidationError(
      "invalid_url",
      `${path} must use HTTPS`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new AuthProviderValidationError(
      "credential_in_url",
      `${path} must not contain credentials`,
    );
  }
  return value.trim();
}

function validateMicrosoftTenantIssuer(value: string, path: string): string {
  const validated = validateUrl(value, path);
  const match = MICROSOFT_TENANT_ISSUER_RE.exec(validated);
  if (!match) {
    throw new AuthProviderValidationError(
      "invalid_microsoft_issuer",
      `${path} must be the exact https://login.microsoftonline.com/<tenant-guid>/v2.0 issuer; common, organizations, and consumers aliases are not accepted by Cognito`,
    );
  }
  return `https://login.microsoftonline.com/${match[1]!.toLowerCase()}/v2.0`;
}

function validateRouteUri(value: string, path: string, family: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new AuthProviderValidationError(
      "invalid_url",
      `${path} must be an absolute URL`,
    );
  }
  if (parsed.username || parsed.password) {
    throw new AuthProviderValidationError(
      "credential_in_url",
      `${path} must not contain credentials`,
    );
  }
  if (parsed.protocol === "https:") return value.trim();
  if (
    parsed.protocol === "http:" &&
    (parsed.hostname === "127.0.0.1" || parsed.hostname === "localhost")
  ) {
    return value.trim();
  }
  const customSchemeAllowed = family === "mobile" || family === "desktop";
  if (
    customSchemeAllowed &&
    /^[a-z][a-z0-9+.-]*:$/.test(parsed.protocol) &&
    !["data:", "file:", "javascript:"].includes(parsed.protocol)
  ) {
    return value.trim();
  }
  throw new AuthProviderValidationError(
    "invalid_url",
    `${path} must use HTTPS, an approved loopback URL, or a native-app scheme`,
  );
}

function validateResourceArn(
  value: string | undefined,
  account: string,
  region: string,
  path: string,
): string | undefined {
  if (!value) return undefined;
  const prefix = `arn:aws:`;
  if (!value.startsWith(prefix) || !value.includes(`:${region}:${account}:`)) {
    throw new AuthProviderValidationError(
      "resource_scope_mismatch",
      `${path} must belong to the submitted AWS account and region`,
    );
  }
  return value;
}

function validateSecretRef(
  value: string | undefined,
  stage: string,
  account: string,
  region: string,
  path: string,
): string | undefined {
  if (!value) return undefined;
  const prefix = `arn:aws:secretsmanager:${region}:${account}:secret:thinkwork/${stage}/auth/`;
  if (!value.startsWith(prefix) || value.length <= prefix.length) {
    throw new AuthProviderValidationError(
      "secret_ref_scope_mismatch",
      `${path} must be a stage-scoped ThinkWork Secrets Manager ARN`,
    );
  }
  return value;
}

function parseConnection(
  raw: unknown,
  index: number,
  envelope: Pick<
    SafeAuthReconcilePayload,
    "stage" | "awsAccountId" | "awsRegion"
  >,
): SafeAuthConnectionMetadata {
  const path = `connections[${index}]`;
  const value = object(raw, path);
  assertOnlyKeys(
    value,
    [
      "connectionKey",
      "providerKey",
      "providerKind",
      "displayName",
      "lifecycleState",
      "cognitoUserPoolId",
      "cognitoIdentityProviderName",
      "issuerUrl",
      "clientId",
      "clientSecretRef",
      "resourceArn",
      "authorizeScopes",
      "tenantBindings",
    ],
    path,
  );
  const connectionKey = string(
    value.connectionKey,
    `${path}.connectionKey`,
  ).toLowerCase();
  const providerKey = string(
    value.providerKey,
    `${path}.providerKey`,
  ).toLowerCase();
  const providerKind = string(value.providerKind, `${path}.providerKind`);
  const lifecycleState = string(value.lifecycleState, `${path}.lifecycleState`);
  const poolId = string(value.cognitoUserPoolId, `${path}.cognitoUserPoolId`);
  if (
    !CONNECTION_KEY_RE.test(connectionKey) ||
    !CONNECTION_KEY_RE.test(providerKey)
  ) {
    throw new AuthProviderValidationError(
      "invalid_connection_key",
      `${path} contains an invalid key`,
    );
  }
  if (!CONNECTION_KINDS.has(providerKind)) {
    throw new AuthProviderValidationError(
      "invalid_provider_kind",
      `${path}.providerKind is not supported`,
    );
  }
  if (!LIFECYCLE_STATES.has(lifecycleState)) {
    throw new AuthProviderValidationError(
      "invalid_lifecycle",
      `${path}.lifecycleState is not supported`,
    );
  }
  if (
    !USER_POOL_ID_RE.test(poolId) ||
    !poolId.startsWith(`${envelope.awsRegion}_`)
  ) {
    throw new AuthProviderValidationError(
      "invalid_user_pool",
      `${path}.cognitoUserPoolId must match awsRegion`,
    );
  }

  const providerName = string(
    value.cognitoIdentityProviderName,
    `${path}.cognitoIdentityProviderName`,
  );
  if (!PROVIDER_NAME_RE.test(providerName)) {
    throw new AuthProviderValidationError(
      "invalid_provider_name",
      `${path} has an invalid Cognito provider name`,
    );
  }

  const bindings = Array.isArray(value.tenantBindings)
    ? value.tenantBindings
    : [];
  const tenantBindings = bindings.map((entry, bindingIndex) => {
    const bindingPath = `${path}.tenantBindings[${bindingIndex}]`;
    const binding = object(entry, bindingPath);
    assertOnlyKeys(
      binding,
      ["tenantId", "label", "hostnames", "status"],
      bindingPath,
    );
    const tenantId = string(binding.tenantId, `${bindingPath}.tenantId`);
    const status = string(binding.status, `${bindingPath}.status`);
    if (!UUID_RE.test(tenantId)) {
      throw new AuthProviderValidationError(
        "invalid_tenant",
        `${bindingPath}.tenantId must be a UUID`,
      );
    }
    if (
      !["disabled", "enabled", "invalid", "decommissioning"].includes(status)
    ) {
      throw new AuthProviderValidationError(
        "invalid_binding_status",
        `${bindingPath}.status is invalid`,
      );
    }
    const hostnames = stringArray(
      binding.hostnames,
      `${bindingPath}.hostnames`,
    ).map((hostname) => {
      const normalized = hostname.toLowerCase().replace(/\.$/, "");
      if (
        !/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z]{2,63}$/.test(
          normalized,
        )
      ) {
        throw new AuthProviderValidationError(
          "invalid_hostname",
          `${bindingPath} contains an invalid hostname`,
        );
      }
      return normalized;
    });
    return {
      tenantId,
      label: string(binding.label, `${bindingPath}.label`),
      hostnames,
      status:
        status as SafeAuthConnectionMetadata["tenantBindings"][number]["status"],
    };
  });

  const rawIssuerUrl = optionalString(value.issuerUrl, `${path}.issuerUrl`);
  const issuerUrl =
    providerKind === "microsoft_organizations" ||
    providerKind === "microsoft_tenant"
      ? validateMicrosoftTenantIssuer(
          string(rawIssuerUrl, `${path}.issuerUrl`),
          `${path}.issuerUrl`,
        )
      : rawIssuerUrl
        ? validateUrl(rawIssuerUrl, `${path}.issuerUrl`)
        : undefined;

  if (providerKind === "microsoft_organizations") {
    if (
      connectionKey !== "microsoft:organizations" ||
      providerKey !== "microsoft" ||
      providerName !== "MicrosoftOrganizations" ||
      tenantBindings.length !== 0
    ) {
      throw new AuthProviderValidationError(
        "invalid_microsoft_scope",
        `${path} must be the deployment-wide MicrosoftOrganizations connection with no tenant binding`,
      );
    }
  }
  if (providerKind === "microsoft_tenant") {
    const issuerTenantId = MICROSOFT_TENANT_ISSUER_RE.exec(
      issuerUrl ?? "",
    )?.[1]?.toLowerCase();
    if (
      !issuerTenantId ||
      connectionKey !== `microsoft:tenant:${issuerTenantId}` ||
      providerKey !== "microsoft" ||
      !/^Entra_[a-f0-9]{16}_[a-f0-9]{8}$/.test(providerName) ||
      tenantBindings.length !== 1
    ) {
      throw new AuthProviderValidationError(
        "invalid_microsoft_scope",
        `${path} must bind one ThinkWork tenant to the exact Entra directory encoded by its issuer and connection key`,
      );
    }
  }

  return {
    connectionKey,
    providerKey,
    providerKind,
    displayName: string(value.displayName, `${path}.displayName`),
    lifecycleState:
      lifecycleState as SafeAuthConnectionMetadata["lifecycleState"],
    cognitoUserPoolId: poolId,
    cognitoIdentityProviderName: providerName,
    issuerUrl,
    clientId: optionalString(value.clientId, `${path}.clientId`),
    clientSecretRef: validateSecretRef(
      optionalString(value.clientSecretRef, `${path}.clientSecretRef`),
      envelope.stage,
      envelope.awsAccountId,
      envelope.awsRegion,
      `${path}.clientSecretRef`,
    ),
    resourceArn: validateResourceArn(
      optionalString(value.resourceArn, `${path}.resourceArn`),
      envelope.awsAccountId,
      envelope.awsRegion,
      `${path}.resourceArn`,
    ),
    authorizeScopes: string(value.authorizeScopes, `${path}.authorizeScopes`),
    tenantBindings,
  };
}

function parseRoute(
  raw: unknown,
  index: number,
  envelope: Pick<SafeAuthReconcilePayload, "awsAccountId" | "awsRegion">,
): SafeAuthRouteClientMetadata {
  const path = `routeClients[${index}]`;
  const value = object(raw, path);
  assertOnlyKeys(
    value,
    [
      "routeKey",
      "clientFamily",
      "cognitoUserPoolId",
      "cognitoAppClientId",
      "providerNames",
      "explicitAuthFlows",
      "redirectUris",
      "logoutUris",
      "lifecycleState",
      "resourceArn",
    ],
    path,
  );
  const family = string(value.clientFamily, `${path}.clientFamily`);
  const lifecycle = string(value.lifecycleState, `${path}.lifecycleState`);
  const poolId = string(value.cognitoUserPoolId, `${path}.cognitoUserPoolId`);
  const appClientId = string(
    value.cognitoAppClientId,
    `${path}.cognitoAppClientId`,
  );
  if (!CLIENT_FAMILIES.has(family)) {
    throw new AuthProviderValidationError(
      "invalid_client_family",
      `${path}.clientFamily is invalid`,
    );
  }
  if (!LIFECYCLE_STATES.has(lifecycle)) {
    throw new AuthProviderValidationError(
      "invalid_lifecycle",
      `${path}.lifecycleState is invalid`,
    );
  }
  if (
    !USER_POOL_ID_RE.test(poolId) ||
    !poolId.startsWith(`${envelope.awsRegion}_`)
  ) {
    throw new AuthProviderValidationError(
      "invalid_user_pool",
      `${path}.cognitoUserPoolId must match awsRegion`,
    );
  }
  if (!APP_CLIENT_ID_RE.test(appClientId)) {
    throw new AuthProviderValidationError(
      "invalid_app_client",
      `${path}.cognitoAppClientId is invalid`,
    );
  }
  const providerNames = stringArray(
    value.providerNames,
    `${path}.providerNames`,
  );
  const explicitAuthFlows = stringArray(
    value.explicitAuthFlows,
    `${path}.explicitAuthFlows`,
  );
  if (providerNames.length !== 1) {
    throw new AuthProviderValidationError(
      "invalid_route_provider",
      `${path} must allow exactly one identity provider`,
    );
  }
  const expectedFlows =
    providerNames[0] === "COGNITO"
      ? new Set([
          "ALLOW_USER_PASSWORD_AUTH",
          "ALLOW_USER_SRP_AUTH",
          "ALLOW_REFRESH_TOKEN_AUTH",
        ])
      : new Set(["ALLOW_REFRESH_TOKEN_AUTH"]);
  if (
    explicitAuthFlows.some((flow) => !expectedFlows.has(flow)) ||
    !explicitAuthFlows.includes("ALLOW_REFRESH_TOKEN_AUTH") ||
    (providerNames[0] === "COGNITO" &&
      !explicitAuthFlows.some((flow) =>
        ["ALLOW_USER_PASSWORD_AUTH", "ALLOW_USER_SRP_AUTH"].includes(flow),
      ))
  ) {
    throw new AuthProviderValidationError(
      "unsafe_auth_flow",
      `${path} enables an authentication flow outside its route boundary`,
    );
  }
  return {
    routeKey: string(value.routeKey, `${path}.routeKey`).toLowerCase(),
    clientFamily: family as SafeAuthRouteClientMetadata["clientFamily"],
    cognitoUserPoolId: poolId,
    cognitoAppClientId: appClientId,
    providerNames,
    explicitAuthFlows,
    redirectUris: stringArray(value.redirectUris, `${path}.redirectUris`).map(
      (uri) => validateRouteUri(uri, `${path}.redirectUris`, family),
    ),
    logoutUris: stringArray(value.logoutUris, `${path}.logoutUris`).map((uri) =>
      validateRouteUri(uri, `${path}.logoutUris`, family),
    ),
    lifecycleState: lifecycle as SafeAuthRouteClientMetadata["lifecycleState"],
    resourceArn: validateResourceArn(
      optionalString(value.resourceArn, `${path}.resourceArn`),
      envelope.awsAccountId,
      envelope.awsRegion,
      `${path}.resourceArn`,
    ),
  };
}

export function canonicalAuthManifestFingerprint(
  payload: Omit<SafeAuthReconcilePayload, "manifestFingerprint">,
): string {
  const canonical = JSON.stringify({
    ...payload,
    connections: [...payload.connections].sort((a, b) =>
      a.connectionKey.localeCompare(b.connectionKey),
    ),
    routeClients: [...payload.routeClients].sort((a, b) =>
      `${a.routeKey}:${a.clientFamily}`.localeCompare(
        `${b.routeKey}:${b.clientFamily}`,
      ),
    ),
  });
  return createHash("sha256").update(canonical).digest("hex");
}

export function validateAuthProviderMetadata(
  raw: unknown,
): SafeAuthReconcilePayload {
  const value = object(raw, "payload");
  assertOnlyKeys(
    value,
    [
      "stage",
      "awsAccountId",
      "awsRegion",
      "revision",
      "expectedPreviousRevision",
      "idempotencyKey",
      "manifestFingerprint",
      "connections",
      "routeClients",
    ],
    "payload",
  );
  const stage = string(value.stage, "stage").toLowerCase();
  const awsAccountId = string(value.awsAccountId, "awsAccountId");
  const awsRegion = string(value.awsRegion, "awsRegion");
  if (
    !STAGE_RE.test(stage) ||
    !ACCOUNT_ID_RE.test(awsAccountId) ||
    !REGION_RE.test(awsRegion)
  ) {
    throw new AuthProviderValidationError(
      "invalid_aws_scope",
      "stage, account, or region is invalid",
    );
  }
  if (!Number.isInteger(value.revision) || (value.revision as number) < 1) {
    throw new AuthProviderValidationError(
      "invalid_revision",
      "revision must be a positive integer",
    );
  }
  if (
    !Number.isInteger(value.expectedPreviousRevision) ||
    (value.expectedPreviousRevision as number) < 0
  ) {
    throw new AuthProviderValidationError(
      "invalid_revision",
      "expectedPreviousRevision must be a non-negative integer",
    );
  }
  const idempotencyKey = string(value.idempotencyKey, "idempotencyKey");
  const manifestFingerprint = string(
    value.manifestFingerprint,
    "manifestFingerprint",
  );
  if (!UUID_RE.test(idempotencyKey) || !SHA256_RE.test(manifestFingerprint)) {
    throw new AuthProviderValidationError(
      "invalid_reconciliation_identity",
      "idempotencyKey must be a UUID and manifestFingerprint must be SHA-256",
    );
  }
  if (!Array.isArray(value.connections) || !Array.isArray(value.routeClients)) {
    throw new AuthProviderValidationError(
      "invalid_shape",
      "connections and routeClients must be arrays",
    );
  }
  const envelope = { stage, awsAccountId, awsRegion };
  const connections = value.connections.map((entry, index) =>
    parseConnection(entry, index, envelope),
  );
  const routeClients = value.routeClients.map((entry, index) =>
    parseRoute(entry, index, envelope),
  );
  const connectionKeys = connections.map((entry) => entry.connectionKey);
  const routeKeys = routeClients.map(
    (entry) => `${entry.routeKey}:${entry.clientFamily}`,
  );
  if (
    new Set(connectionKeys).size !== connectionKeys.length ||
    new Set(routeKeys).size !== routeKeys.length
  ) {
    throw new AuthProviderValidationError(
      "duplicate_resource",
      "connection and route identities must be unique",
    );
  }
  const payload: SafeAuthReconcilePayload = {
    ...envelope,
    revision: value.revision as number,
    expectedPreviousRevision: value.expectedPreviousRevision as number,
    idempotencyKey,
    manifestFingerprint,
    connections,
    routeClients,
  };
  const { manifestFingerprint: _submitted, ...fingerprintInput } = payload;
  if (
    canonicalAuthManifestFingerprint(fingerprintInput) !== manifestFingerprint
  ) {
    throw new AuthProviderValidationError(
      "manifest_fingerprint_mismatch",
      "manifestFingerprint does not match the normalized safe metadata",
    );
  }
  return payload;
}
