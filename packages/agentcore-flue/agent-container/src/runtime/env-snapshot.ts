export interface RuntimeEnv {
  awsRegion: string;
  gitSha: string;
  buildTime: string;
  workspaceBucket: string;
  workspaceDir: string;
}

export function snapshotRuntimeEnv(
  env: NodeJS.ProcessEnv = process.env,
): RuntimeEnv {
  return {
    awsRegion: env.AWS_REGION || "us-east-1",
    gitSha: env.THINKWORK_GIT_SHA || "unknown",
    buildTime: env.THINKWORK_BUILD_TIME || "unknown",
    workspaceBucket: env.WORKSPACE_BUCKET || env.AGENTCORE_FILES_BUCKET || "",
    workspaceDir: env.WORKSPACE_DIR || "/tmp/workspace",
  };
}
