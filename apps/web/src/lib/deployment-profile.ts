import {
  assessDeploymentProfile,
  buildDeploymentProfile,
  deploymentProfileSha256,
  type DeploymentProfile,
  type DeploymentProfileTrustStatus,
  type DeploymentProfileValidationIssue,
} from "@thinkwork/deployment-profile";

type SpacesEnv = ImportMetaEnv & Record<string, string | boolean | undefined>;

export interface SpacesDeploymentProfileSnapshot {
  profile: DeploymentProfile | null;
  profileJson: string;
  profileSha256: string | null;
  displayName: string;
  stage: string;
  region: string;
  status: DeploymentProfileTrustStatus;
  okForOAuth: boolean;
  trustLabel: string;
  issues: DeploymentProfileValidationIssue[];
  missing: string[];
}

export function getSpacesDeploymentProfileSnapshot(
  env: SpacesEnv = import.meta.env,
  origin = browserOrigin(),
): SpacesDeploymentProfileSnapshot {
  const stage = stringEnv(env.VITE_STAGE) || "dev";
  const displayName =
    stringEnv(env.VITE_DEPLOYMENT_DISPLAY_NAME) || "ThinkWork";
  const region = stringEnv(env.VITE_AWS_REGION) || "us-east-1";
  const apiUrl = stringEnv(env.VITE_API_URL);
  const appsyncHttpUrl = stringEnv(env.VITE_GRAPHQL_URL);
  const values = {
    deploymentId: stringEnv(env.VITE_DEPLOYMENT_ID) || `thinkwork-${stage}`,
    displayName,
    stage,
    region,
    issuedAt:
      stringEnv(env.VITE_DEPLOYMENT_PROFILE_ISSUED_AT) ||
      new Date().toISOString(),
    spacesUrl: stringEnv(env.VITE_SPACES_URL) || origin,
    apiUrl,
    graphqlHttpUrl:
      stringEnv(env.VITE_GRAPHQL_HTTP_URL) || appendPath(apiUrl, "graphql"),
    appsyncHttpUrl,
    appsyncWsUrl:
      stringEnv(env.VITE_GRAPHQL_WS_URL) || httpUrlToWsUrl(appsyncHttpUrl),
    cognitoDomain: stringEnv(env.VITE_COGNITO_DOMAIN),
    cognitoUserPoolId: stringEnv(env.VITE_COGNITO_USER_POOL_ID),
    cognitoClientId: stringEnv(env.VITE_COGNITO_CLIENT_ID),
    signature: null,
  };

  const missing = Object.entries(values)
    .filter(
      ([key, value]) =>
        key !== "signature" && (typeof value !== "string" || !value.trim()),
    )
    .map(([key]) => envNameForProfileField(key));

  if (missing.length > 0) {
    const issues = missing.map((field) => ({
      status: "missing_required_field" as const,
      field,
      message: `Deployment profile is missing ${field}.`,
    }));
    return {
      profile: null,
      profileJson: JSON.stringify(
        {
          schemaVersion: 1,
          deploymentId: values.deploymentId,
          displayName,
          stage,
          region,
          missing,
        },
        null,
        2,
      ),
      profileSha256: null,
      displayName,
      stage,
      region,
      status: "missing_required_field",
      okForOAuth: false,
      trustLabel: "Configuration incomplete",
      issues,
      missing,
    };
  }

  const profile = buildDeploymentProfile(values);
  const result = assessDeploymentProfile(profile, {
    allowUnsigned: true,
    allowHttpLocalhost: Boolean(env.DEV),
  });
  const profileSha256 = deploymentProfileSha256(profile);

  return {
    profile,
    profileJson: JSON.stringify(profile, null, 2),
    profileSha256,
    displayName,
    stage,
    region,
    status: result.status,
    okForOAuth: result.ok || result.status === "unsigned",
    trustLabel: trustLabel(result.status),
    issues: result.issues,
    missing: [],
  };
}

function browserOrigin(): string {
  if (typeof window !== "undefined") {
    if (window.location.origin) return window.location.origin;
    try {
      return new URL(window.location.href).origin;
    } catch {
      return "http://localhost:5174";
    }
  }
  return "http://localhost:5174";
}

function stringEnv(value: string | boolean | undefined): string {
  return typeof value === "string" ? value.trim() : "";
}

function appendPath(baseUrl: string, path: string): string {
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function httpUrlToWsUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("https://"))
    return `wss://${url.slice("https://".length)}`;
  if (url.startsWith("http://")) return `ws://${url.slice("http://".length)}`;
  return "";
}

function envNameForProfileField(field: string): string {
  const names: Record<string, string> = {
    apiUrl: "VITE_API_URL",
    graphqlHttpUrl: "VITE_GRAPHQL_HTTP_URL",
    appsyncHttpUrl: "VITE_GRAPHQL_URL",
    appsyncWsUrl: "VITE_GRAPHQL_WS_URL",
    cognitoDomain: "VITE_COGNITO_DOMAIN",
    cognitoUserPoolId: "VITE_COGNITO_USER_POOL_ID",
    cognitoClientId: "VITE_COGNITO_CLIENT_ID",
    spacesUrl: "VITE_SPACES_URL",
  };
  return names[field] ?? field;
}

function trustLabel(status: DeploymentProfileTrustStatus): string {
  switch (status) {
    case "trusted":
      return "Trusted";
    case "unsigned":
      return "Unsigned build-time fallback";
    case "missing_required_field":
      return "Configuration incomplete";
    case "malformed_url":
      return "Invalid endpoint URL";
    case "malformed_json":
      return "Malformed profile";
    case "unsupported_schema":
      return "Unsupported profile schema";
    case "unknown_key":
      return "Unknown signing key";
    case "invalid_signature":
      return "Invalid signature";
    case "endpoint_mismatch":
      return "Endpoint mismatch";
    case "expired":
      return "Expired profile";
  }
}
