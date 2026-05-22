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

export function snapshotDesktopEnv(
  env: NodeJS.ProcessEnv = process.env,
): DesktopEnvSnapshot {
  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? "development",
    stage: env.THINKWORK_STAGE ?? env.VITE_THINKWORK_STAGE ?? "dev",
    rendererUrl: env.ELECTRON_RENDERER_URL ?? null,
    apiUrl: env.VITE_API_URL ?? null,
    graphqlHttpUrl: env.VITE_GRAPHQL_HTTP_URL ?? null,
    graphqlUrl: env.VITE_GRAPHQL_URL ?? null,
    graphqlWsUrl: env.VITE_GRAPHQL_WS_URL ?? null,
    sandboxFrameSrc: env.VITE_SANDBOX_IFRAME_SRC ?? null,
    cognito: Object.freeze({
      userPoolId: env.VITE_COGNITO_USER_POOL_ID ?? null,
      clientId: env.VITE_COGNITO_CLIENT_ID ?? null,
      domain: env.VITE_COGNITO_DOMAIN ?? null,
    }),
  });
}
