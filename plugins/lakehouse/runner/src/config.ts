export interface RunnerConfig {
  runnerId: string;
  integrationKey: string;
  workspaceRoot: string;
  apiBaseUrl: string;
  bundleBucketRef: string;
}

export function validateRunnerConfig(config: RunnerConfig): RunnerConfig {
  for (const [key, value] of Object.entries(config)) {
    if (typeof value !== "string" || value.trim().length === 0) {
      throw new Error(`Runner config field is required: ${key}`);
    }
  }
  return config;
}
