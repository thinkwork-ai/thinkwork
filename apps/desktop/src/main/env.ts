export interface CognitoEnvSnapshot {
  userPoolId: string | null;
  clientId: string | null;
  domain: string | null;
}

export interface DesktopEnvSnapshot {
  nodeEnv: string;
  stage: string;
  desktopChannel: string;
  desktopProductName: string;
  desktopAppId: string;
  desktopLocalPiEnabled: boolean;
  deepLinkScheme: string | null;
  rendererUrl: string | null;
  apiUrl: string | null;
  graphqlHttpUrl: string | null;
  graphqlUrl: string | null;
  graphqlWsUrl: string | null;
  sandboxFrameSrc: string | null;
  cognito: CognitoEnvSnapshot;
}

export interface DesktopEnvValidation {
  configured: boolean;
  missing: readonly string[];
}

declare const __THINKWORK_DESKTOP_ENV__:
  | Partial<Record<string, string>>
  | undefined;

export function snapshotDesktopEnv(
  env: NodeJS.ProcessEnv = process.env,
): DesktopEnvSnapshot {
  const mergedEnv = mergeDesktopEnv(env);
  const stage =
    optionalEnv(mergedEnv.THINKWORK_STAGE) ??
    optionalEnv(mergedEnv.VITE_THINKWORK_STAGE) ??
    "dev";
  const desktopChannel =
    optionalEnv(mergedEnv.THINKWORK_DESKTOP_CHANNEL) ?? stage;

  return Object.freeze({
    nodeEnv: optionalEnv(mergedEnv.NODE_ENV) ?? "development",
    stage,
    desktopChannel,
    desktopProductName:
      optionalEnv(mergedEnv.THINKWORK_DESKTOP_PRODUCT_NAME) ??
      "ThinkWork Spaces",
    desktopAppId:
      optionalEnv(mergedEnv.THINKWORK_DESKTOP_APP_ID) ??
      "ai.thinkwork.spaces.desktop.dev",
    desktopLocalPiEnabled: resolveDesktopLocalPiEnabled(mergedEnv, stage),
    deepLinkScheme: optionalEnv(mergedEnv.THINKWORK_DESKTOP_SCHEME),
    rendererUrl: optionalEnv(mergedEnv.ELECTRON_RENDERER_URL),
    apiUrl: optionalEnv(mergedEnv.VITE_API_URL),
    graphqlHttpUrl: optionalEnv(mergedEnv.VITE_GRAPHQL_HTTP_URL),
    graphqlUrl: optionalEnv(mergedEnv.VITE_GRAPHQL_URL),
    graphqlWsUrl: optionalEnv(mergedEnv.VITE_GRAPHQL_WS_URL),
    sandboxFrameSrc: optionalEnv(mergedEnv.VITE_SANDBOX_IFRAME_SRC),
    cognito: Object.freeze({
      userPoolId: optionalEnv(mergedEnv.VITE_COGNITO_USER_POOL_ID),
      clientId: optionalEnv(mergedEnv.VITE_COGNITO_CLIENT_ID),
      domain: optionalEnv(mergedEnv.VITE_COGNITO_DOMAIN),
    }),
  });
}

export function validateDesktopEnv(
  env: DesktopEnvSnapshot,
): DesktopEnvValidation {
  const required: Array<[string, string | null]> = [
    ["VITE_API_URL", env.apiUrl],
    ["VITE_GRAPHQL_HTTP_URL", env.graphqlHttpUrl],
    ["VITE_GRAPHQL_URL", env.graphqlUrl],
    ["VITE_GRAPHQL_WS_URL", env.graphqlWsUrl],
    ["VITE_COGNITO_USER_POOL_ID", env.cognito.userPoolId],
    ["VITE_COGNITO_CLIENT_ID", env.cognito.clientId],
    ["VITE_COGNITO_DOMAIN", env.cognito.domain],
  ];
  const missing = required.filter(([, value]) => !value).map(([key]) => key);

  return Object.freeze({
    configured: missing.length === 0,
    missing: Object.freeze(missing),
  });
}

function mergeDesktopEnv(env: NodeJS.ProcessEnv): NodeJS.ProcessEnv {
  const buildEnv =
    typeof __THINKWORK_DESKTOP_ENV__ === "undefined"
      ? {}
      : __THINKWORK_DESKTOP_ENV__;

  return {
    ...buildEnv,
    ...env,
  };
}

function optionalEnv(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

function resolveDesktopLocalPiEnabled(
  env: NodeJS.ProcessEnv,
  stage: string,
): boolean {
  const explicit =
    optionalEnv(env.THINKWORK_DESKTOP_LOCAL_PI_ENABLED) ??
    optionalEnv(env.VITE_DESKTOP_LOCAL_PI_ENABLED);
  if (explicit) return parseBooleanEnv(explicit);
  return stage === "dev" || stage === "canary";
}

function parseBooleanEnv(value: string): boolean {
  return /^(1|true|yes|on|enabled)$/i.test(value.trim());
}
