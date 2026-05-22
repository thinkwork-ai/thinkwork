export interface CognitoEnvSnapshot {
  userPoolId: string | null;
  clientId: string | null;
  domain: string | null;
}

export interface DesktopEnvSnapshot {
  nodeEnv: string;
  stage: string;
  rendererUrl: string | null;
  cognito: CognitoEnvSnapshot;
}

export function snapshotDesktopEnv(
  env: NodeJS.ProcessEnv = process.env,
): DesktopEnvSnapshot {
  return Object.freeze({
    nodeEnv: env.NODE_ENV ?? "development",
    stage: env.THINKWORK_STAGE ?? env.VITE_THINKWORK_STAGE ?? "dev",
    rendererUrl: env.ELECTRON_RENDERER_URL ?? null,
    cognito: Object.freeze({
      userPoolId: env.VITE_COGNITO_USER_POOL_ID ?? null,
      clientId: env.VITE_COGNITO_CLIENT_ID ?? null,
      domain: env.VITE_COGNITO_DOMAIN ?? null,
    }),
  });
}
