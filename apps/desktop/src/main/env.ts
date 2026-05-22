export interface CognitoEnvSnapshot {
  userPoolId: string | null;
  clientId: string | null;
  domain: string | null;
}

export interface DesktopEnvSnapshot {
  nodeEnv: string;
  stage: string;
  rendererUrl: string | null;
  apiUrl: string | null;
  graphqlHttpUrl: string | null;
  graphqlUrl: string | null;
  graphqlWsUrl: string | null;
  sandboxFrameSrc: string | null;
  cognito: CognitoEnvSnapshot;
}

declare const __THINKWORK_DESKTOP_ENV__:
  | Partial<Record<string, string>>
  | undefined;

export function snapshotDesktopEnv(
  env: NodeJS.ProcessEnv = process.env,
): DesktopEnvSnapshot {
  const mergedEnv = mergeDesktopEnv(env);

  return Object.freeze({
    nodeEnv: mergedEnv.NODE_ENV ?? "development",
    stage: mergedEnv.THINKWORK_STAGE ?? mergedEnv.VITE_THINKWORK_STAGE ?? "dev",
    rendererUrl: mergedEnv.ELECTRON_RENDERER_URL ?? null,
    apiUrl: mergedEnv.VITE_API_URL ?? null,
    graphqlHttpUrl: mergedEnv.VITE_GRAPHQL_HTTP_URL ?? null,
    graphqlUrl: mergedEnv.VITE_GRAPHQL_URL ?? null,
    graphqlWsUrl: mergedEnv.VITE_GRAPHQL_WS_URL ?? null,
    sandboxFrameSrc: mergedEnv.VITE_SANDBOX_IFRAME_SRC ?? null,
    cognito: Object.freeze({
      userPoolId: mergedEnv.VITE_COGNITO_USER_POOL_ID ?? null,
      clientId: mergedEnv.VITE_COGNITO_CLIENT_ID ?? null,
      domain: mergedEnv.VITE_COGNITO_DOMAIN ?? null,
    }),
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
