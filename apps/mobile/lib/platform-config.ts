import type { DeploymentProfileValidationIssue } from "@thinkwork/deployment-profile";
import {
  getDeploymentProfileSnapshot,
  hydrateDeploymentProfile,
  runtimeConfigFromProfile,
  subscribeDeploymentProfile,
  type MobileDeploymentProfileSummary,
} from "./deployment-profile";

export interface MobilePlatformConfig {
  stage: string;
  apiUrl: string;
  graphqlHttpUrl: string;
  graphqlUrl: string;
  graphqlWsUrl: string;
  graphqlApiKey: string;
  cognitoUserPoolId: string;
  cognitoClientId: string;
  cognitoDomain: string;
  configured: boolean;
  missing: string[];
  issues: DeploymentProfileValidationIssue[];
  deployment: MobileDeploymentProfileSummary;
}

type PlatformConfigListener = (config: MobilePlatformConfig) => void;

const listeners = new Set<PlatformConfigListener>();

export async function hydratePlatformConfig(): Promise<MobilePlatformConfig> {
  await hydrateDeploymentProfile();
  const config = getPlatformConfig();
  notify(config);
  return config;
}

export function getPlatformConfig(): MobilePlatformConfig {
  const profileSnapshot = getDeploymentProfileSnapshot();
  if (profileSnapshot.profile) {
    const runtime = runtimeConfigFromProfile(profileSnapshot.profile);
    const config = {
      stage: runtime.stage,
      apiUrl: runtime.apiUrl,
      graphqlHttpUrl: runtime.graphqlHttpUrl,
      graphqlUrl: runtime.graphqlUrl,
      graphqlWsUrl: runtime.graphqlWsUrl,
      graphqlApiKey: env("EXPO_PUBLIC_GRAPHQL_API_KEY"),
      cognitoUserPoolId: runtime.cognitoUserPoolId,
      cognitoClientId: runtime.cognitoClientId,
      cognitoDomain: runtime.cognitoDomain,
      issues: profileSnapshot.issues,
      deployment: profileSnapshot.summary!,
    };
    return {
      ...config,
      ...validationFor(config),
    };
  }

  const envConfig = envPlatformConfig(profileSnapshot.issues);
  return {
    ...envConfig,
    ...validationFor(envConfig),
  };
}

export function subscribePlatformConfig(listener: PlatformConfigListener) {
  listeners.add(listener);
  const unsubscribeProfile = subscribeDeploymentProfile(() => {
    const config = getPlatformConfig();
    notify(config);
  });
  return () => {
    listeners.delete(listener);
    unsubscribeProfile();
  };
}

export function formatPlatformConfigMissing(config = getPlatformConfig()) {
  return config.missing.join(", ");
}

function notify(config: MobilePlatformConfig) {
  listeners.forEach((listener) => listener(config));
}

function envPlatformConfig(
  issues: DeploymentProfileValidationIssue[],
): Omit<MobilePlatformConfig, "configured" | "missing"> {
  const stage = env("EXPO_PUBLIC_STAGE") || env("EXPO_PUBLIC_THINKWORK_STAGE");
  const graphqlUrl = env("EXPO_PUBLIC_GRAPHQL_URL");
  const apiUrl = env("EXPO_PUBLIC_API_URL") || stripGraphqlPath(graphqlUrl);
  const graphqlHttpUrl =
    env("EXPO_PUBLIC_GRAPHQL_HTTP_URL") || appendPath(apiUrl, "graphql");
  const graphqlWsUrl =
    env("EXPO_PUBLIC_GRAPHQL_WS_URL") || httpUrlToWsUrl(graphqlUrl);

  return {
    stage: stage || "dev",
    apiUrl,
    graphqlHttpUrl,
    graphqlUrl,
    graphqlWsUrl,
    graphqlApiKey: env("EXPO_PUBLIC_GRAPHQL_API_KEY"),
    cognitoUserPoolId: env("EXPO_PUBLIC_COGNITO_USER_POOL_ID"),
    cognitoClientId: env("EXPO_PUBLIC_COGNITO_CLIENT_ID"),
    cognitoDomain: normalizedCognitoDomain(env("EXPO_PUBLIC_COGNITO_DOMAIN")),
    issues,
    deployment: {
      source: "env",
      deploymentId: env("EXPO_PUBLIC_DEPLOYMENT_ID") || null,
      displayName: env("EXPO_PUBLIC_DEPLOYMENT_DISPLAY_NAME") || "ThinkWork",
      stage: stage || "dev",
      region: env("EXPO_PUBLIC_AWS_REGION") || null,
      profileSha256: null,
      trustStatus: "unsigned",
      trustLabel: "Build-time fallback",
    },
  };
}

function validationFor(
  config: Omit<MobilePlatformConfig, "configured" | "missing">,
): Pick<MobilePlatformConfig, "configured" | "missing"> {
  type RequiredConfigKey =
    | "graphqlUrl"
    | "cognitoUserPoolId"
    | "cognitoClientId"
    | "cognitoDomain";
  const required: Array<[RequiredConfigKey, string]> = [
    ["graphqlUrl", "GraphQL URL"],
    ["cognitoUserPoolId", "Cognito user pool"],
    ["cognitoClientId", "Cognito client id"],
    ["cognitoDomain", "Cognito domain"],
  ];
  const missing = required
    .filter(([key]) => {
      const value = config[key];
      return typeof value !== "string" || !value.trim();
    })
    .map(([, label]) => label);

  return {
    configured: missing.length === 0,
    missing,
  };
}

function env(name: string): string {
  return process.env[name]?.trim() ?? "";
}

function appendPath(baseUrl: string, path: string): string {
  if (!baseUrl) return "";
  return `${baseUrl.replace(/\/+$/, "")}/${path.replace(/^\/+/, "")}`;
}

function stripGraphqlPath(url: string): string {
  if (!url) return "";
  return url.replace(/\/graphql\/?$/, "");
}

function httpUrlToWsUrl(url: string): string {
  if (!url) return "";
  if (url.startsWith("https://")) {
    return `wss://${url.slice("https://".length)}`;
  }
  if (url.startsWith("http://")) {
    return `ws://${url.slice("http://".length)}`;
  }
  return "";
}

function normalizedCognitoDomain(domain: string): string {
  if (!domain) return "";
  if (domain.startsWith("https://") || domain.startsWith("http://")) {
    return domain.replace(/\/+$/, "");
  }
  return `https://${domain.replace(/\/+$/, "")}`;
}
