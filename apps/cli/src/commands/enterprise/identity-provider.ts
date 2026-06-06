import { createHash } from "node:crypto";

export const ENTERPRISE_IDENTITY_PROVIDER_TYPES = [
  "none",
  "google",
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
    secretRequired: true,
    issuerUrl: "https://accounts.google.com",
    scopes: ["openid", "email", "profile"],
    attributeMapping: defaultAttributeMapping(input),
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

function defaultAttributeMapping(input: EnterpriseIdentityProviderInput) {
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
