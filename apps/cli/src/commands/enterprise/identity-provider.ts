import { createHash } from "node:crypto";

export const ENTERPRISE_IDENTITY_PROVIDER_TYPES = [
  "none",
  "google",
  "entra",
  "oidc",
  "saml",
] as const;

export type EnterpriseIdentityProviderType =
  (typeof ENTERPRISE_IDENTITY_PROVIDER_TYPES)[number];

export interface EnterpriseIdentityProviderInput {
  type?: EnterpriseIdentityProviderType;
  providerName?: string;
  clientId?: string;
  clientSecret?: string;
  tenantId?: string;
  issuerUrl?: string;
  discoveryUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  jwksUrl?: string;
  scopes?: string[];
  emailAttribute?: string;
  nameAttribute?: string;
  usernameAttribute?: string;
  metadataUrl?: string;
  metadataXml?: string;
  entityId?: string;
  idpIdentifiers?: string[];
}

export interface EnterpriseIdentityProviderPlan {
  type: Exclude<EnterpriseIdentityProviderType, "none">;
  providerName: string;
  clientId?: string;
  tenantId?: string;
  connectionKey?: string;
  secretRequired: boolean;
  issuerUrl?: string;
  discoveryUrl?: string;
  authorizeUrl?: string;
  tokenUrl?: string;
  userInfoUrl?: string;
  jwksUrl?: string;
  scopes?: string[];
  attributeMapping: {
    email: string;
    name: string;
    username: string;
    tenantId?: string;
    objectId?: string;
  };
  metadataUrl?: string;
  metadataXmlSha256?: string;
  entityId?: string;
  idpIdentifiers?: string[];
}

export function buildEnterpriseIdentityProviderPlan(
  input: EnterpriseIdentityProviderInput | undefined,
): EnterpriseIdentityProviderPlan | undefined {
  if (!input || !input.type || input.type === "none") return undefined;

  switch (input.type) {
    case "google":
      return buildGooglePlan(input);
    case "entra":
      return buildTenantEntraPlan(input);
    case "oidc":
      return buildOidcPlan(input);
    case "saml":
      return buildSamlPlan(input);
  }
}

export function parseIdentityProviderType(
  value: string | undefined,
): EnterpriseIdentityProviderType | undefined {
  if (!value) return undefined;
  const normalized = value.toLowerCase();
  if (
    ENTERPRISE_IDENTITY_PROVIDER_TYPES.includes(
      normalized as EnterpriseIdentityProviderType,
    )
  ) {
    return normalized as EnterpriseIdentityProviderType;
  }
  throw new Error(
    `Invalid identity provider "${value}". Must be one of: ${ENTERPRISE_IDENTITY_PROVIDER_TYPES.join(", ")}`,
  );
}

function buildGooglePlan(
  input: EnterpriseIdentityProviderInput,
): EnterpriseIdentityProviderPlan {
  requireValue(input.clientId, "Google identity provider requires client ID.");
  requireValue(
    input.clientSecret,
    "Google identity provider requires client secret.",
  );

  return {
    type: "google",
    providerName: "Google",
    clientId: input.clientId!.trim(),
    secretRequired: true,
    issuerUrl: "https://accounts.google.com",
    scopes: ["openid", "email", "profile"],
    attributeMapping: defaultAttributeMapping(input),
  };
}

const ENTRA_TENANT_GUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

export function buildTenantEntraProviderName(tenantId: string): string {
  const normalized = tenantId.toLowerCase();
  if (!ENTRA_TENANT_GUID_RE.test(normalized)) {
    throw new Error(
      "Microsoft Entra tenant ID must be a GUID; common, consumers, and organizations authorities are not tenant connections.",
    );
  }
  const compact = normalized.replaceAll("-", "");
  return `Entra_${compact.slice(0, 16)}_${sha256(normalized).slice(0, 8)}`;
}

export function buildTenantEntraSecretName(
  stage: string,
  tenantId: string,
): string {
  if (!/^[a-z0-9][a-z0-9-]{0,31}$/.test(stage)) {
    throw new Error(
      "Stage must contain lowercase letters, numbers, or hyphens.",
    );
  }
  buildTenantEntraProviderName(tenantId);
  return `thinkwork/${stage}/auth/entra/${tenantId.toLowerCase()}`;
}

function buildTenantEntraPlan(
  input: EnterpriseIdentityProviderInput,
): EnterpriseIdentityProviderPlan {
  const tenantId = requireValue(
    input.tenantId,
    "Microsoft Entra identity provider requires --idp-tenant-id.",
  ).toLowerCase();
  const providerName = buildTenantEntraProviderName(tenantId);
  const clientId = requireValue(
    input.clientId,
    "Microsoft Entra identity provider requires client ID.",
  );
  requireValue(
    input.clientSecret,
    "Microsoft Entra identity provider requires client secret.",
  );
  const issuerUrl = `https://login.microsoftonline.com/${tenantId}/v2.0`;
  return {
    type: "entra",
    providerName,
    clientId,
    tenantId,
    connectionKey: `microsoft:tenant:${tenantId}`,
    secretRequired: true,
    issuerUrl,
    discoveryUrl: `${issuerUrl}/.well-known/openid-configuration`,
    scopes: ["openid", "email", "profile"],
    attributeMapping: {
      email: "preferred_username",
      name: "name",
      username: "sub",
      tenantId: "tid",
      objectId: "oid",
    },
  };
}

function buildOidcPlan(
  input: EnterpriseIdentityProviderInput,
): EnterpriseIdentityProviderPlan {
  const providerName = requireProviderName(input.providerName, "OIDC");
  requireValue(input.clientId, "OIDC identity provider requires client ID.");
  requireValue(
    input.clientSecret,
    "OIDC identity provider requires client secret.",
  );
  if (!input.issuerUrl && !input.discoveryUrl) {
    throw new Error(
      "OIDC identity provider requires --idp-issuer-url or --idp-discovery-url.",
    );
  }

  const issuerUrl = input.issuerUrl
    ? validatePublicHttpsUrl(input.issuerUrl, "OIDC issuer URL")
    : undefined;
  const discoveryUrl = input.discoveryUrl
    ? validatePublicHttpsUrl(input.discoveryUrl, "OIDC discovery URL")
    : undefined;
  const authorizeUrl = input.authorizeUrl
    ? validatePublicHttpsUrl(input.authorizeUrl, "OIDC authorize URL")
    : undefined;
  const tokenUrl = input.tokenUrl
    ? validatePublicHttpsUrl(input.tokenUrl, "OIDC token URL")
    : undefined;
  const userInfoUrl = input.userInfoUrl
    ? validatePublicHttpsUrl(input.userInfoUrl, "OIDC user-info URL")
    : undefined;
  const jwksUrl = input.jwksUrl
    ? validatePublicHttpsUrl(input.jwksUrl, "OIDC JWKS URL")
    : undefined;

  return {
    type: "oidc",
    providerName,
    clientId: input.clientId!.trim(),
    secretRequired: true,
    issuerUrl,
    discoveryUrl,
    authorizeUrl,
    tokenUrl,
    userInfoUrl,
    jwksUrl,
    scopes: input.scopes?.length
      ? input.scopes
      : ["openid", "email", "profile"],
    attributeMapping: defaultAttributeMapping(input),
  };
}

function buildSamlPlan(
  input: EnterpriseIdentityProviderInput,
): EnterpriseIdentityProviderPlan {
  const providerName = requireProviderName(input.providerName, "SAML");
  if (!input.metadataUrl && !input.metadataXml) {
    throw new Error(
      "SAML identity provider requires --idp-metadata-url or --idp-metadata-xml.",
    );
  }

  const metadataUrl = input.metadataUrl
    ? validatePublicHttpsUrl(input.metadataUrl, "SAML metadata URL")
    : undefined;
  let metadataXmlSha256: string | undefined;
  if (input.metadataXml) {
    validateSamlMetadataXml(input.metadataXml, input.entityId);
    metadataXmlSha256 = sha256(input.metadataXml);
  }

  return {
    type: "saml",
    providerName,
    secretRequired: false,
    metadataUrl,
    metadataXmlSha256,
    entityId: input.entityId,
    idpIdentifiers: input.idpIdentifiers ?? [],
    attributeMapping: defaultAttributeMapping(input),
  };
}

function defaultAttributeMapping(input: EnterpriseIdentityProviderInput): {
  email: string;
  name: string;
  username: string;
  tenantId?: string;
  objectId?: string;
} {
  return {
    email: input.emailAttribute ?? "email",
    name: input.nameAttribute ?? "name",
    username: input.usernameAttribute ?? "sub",
  };
}

function requireProviderName(value: string | undefined, label: string): string {
  const trimmed = value?.trim();
  if (!trimmed) {
    throw new Error(`${label} identity provider requires provider name.`);
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9_-]{1,31}$/.test(trimmed)) {
    throw new Error(
      `${label} identity provider name must be 2-32 ASCII letters, numbers, hyphens, or underscores.`,
    );
  }
  return trimmed;
}

function requireValue(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value.trim();
}

function validatePublicHttpsUrl(value: string, label: string): string {
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    throw new Error(`${label} must be a valid HTTPS URL.`);
  }
  if (parsed.protocol !== "https:") {
    throw new Error(`${label} must use HTTPS.`);
  }
  if (isUnsafeHostname(parsed.hostname)) {
    throw new Error(`${label} must not target localhost or private networks.`);
  }
  return parsed.toString();
}

function isUnsafeHostname(hostname: string): boolean {
  const normalized = hostname.toLowerCase().replace(/^\[|\]$/g, "");
  if (
    normalized === "localhost" ||
    normalized.endsWith(".localhost") ||
    normalized === "0.0.0.0" ||
    normalized === "::1" ||
    normalized.startsWith("127.") ||
    normalized.startsWith("169.254.")
  ) {
    return true;
  }

  const ipv4 = normalized.match(/^(\d+)\.(\d+)\.(\d+)\.(\d+)$/);
  if (!ipv4) return normalized.startsWith("fc") || normalized.startsWith("fd");

  const [a, b] = ipv4.slice(1, 3).map((part) => Number(part));
  return (
    a === 10 || (a === 172 && b >= 16 && b <= 31) || (a === 192 && b === 168)
  );
}

function validateSamlMetadataXml(xml: string, entityId: string | undefined) {
  if (Buffer.byteLength(xml, "utf8") > 256 * 1024) {
    throw new Error("SAML metadata XML must be 256 KiB or smaller.");
  }
  if (/<!DOCTYPE|<!ENTITY/i.test(xml)) {
    throw new Error(
      "SAML metadata XML must not contain DOCTYPE or ENTITY declarations.",
    );
  }
  if (!/<(?:\w+:)?EntityDescriptor\b/.test(xml)) {
    throw new Error("SAML metadata XML must contain an EntityDescriptor.");
  }
  if (!/<(?:\w+:)?X509Certificate\b/.test(xml)) {
    throw new Error(
      "SAML metadata XML must contain at least one X509Certificate.",
    );
  }
  if (entityId && !xml.includes(`entityID="${entityId}"`)) {
    throw new Error(
      "SAML metadata XML entityID does not match configured entity ID.",
    );
  }
}

function sha256(value: string): string {
  return createHash("sha256").update(value).digest("hex");
}
