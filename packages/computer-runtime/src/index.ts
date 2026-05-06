import { ComputerRuntimeApi } from "./api-client.js";
import { smokeGoogleWorkspaceCli } from "./google-cli-smoke.js";
import { runTaskLoopOnce } from "./task-loop.js";
import { ensureWorkspace } from "./workspace.js";

type RuntimeEnv = {
  THINKWORK_API_URL: string;
  THINKWORK_API_SECRET: string;
  TENANT_ID: string;
  COMPUTER_ID: string;
  WORKSPACE_ROOT: string;
  RUNTIME_VERSION: string;
  HEARTBEAT_INTERVAL_MS: number;
  TASK_IDLE_DELAY_MS: number;
};

export function readRuntimeEnv(env = process.env): RuntimeEnv {
  const required = [
    "THINKWORK_API_URL",
    "THINKWORK_API_SECRET",
    "TENANT_ID",
    "COMPUTER_ID",
  ] as const;
  for (const key of required) {
    if (!env[key]) throw new Error(`${key} is required`);
  }
  return {
    THINKWORK_API_URL: env.THINKWORK_API_URL!,
    THINKWORK_API_SECRET: env.THINKWORK_API_SECRET!,
    TENANT_ID: env.TENANT_ID!,
    COMPUTER_ID: env.COMPUTER_ID!,
    WORKSPACE_ROOT: env.WORKSPACE_ROOT || "/workspace",
    RUNTIME_VERSION: env.RUNTIME_VERSION || "phase2-skeleton",
    HEARTBEAT_INTERVAL_MS: Number(env.HEARTBEAT_INTERVAL_MS || 30_000),
    TASK_IDLE_DELAY_MS: Number(env.TASK_IDLE_DELAY_MS || 5_000),
  };
}

export async function main() {
  const env = readRuntimeEnv();
  const api = new ComputerRuntimeApi({
    apiUrl: env.THINKWORK_API_URL,
    apiSecret: env.THINKWORK_API_SECRET,
    tenantId: env.TENANT_ID,
    computerId: env.COMPUTER_ID,
  });

  await ensureWorkspace(env.WORKSPACE_ROOT);
  await api.fetchConfig();
  await api.heartbeat({
    runtimeStatus: "running",
    runtimeVersion: env.RUNTIME_VERSION,
    workspaceRoot: env.WORKSPACE_ROOT,
  });
  console.log(
    JSON.stringify({
      level: "info",
      event: "computer_runtime_started",
      computerId: env.COMPUTER_ID,
      googleWorkspaceCli: await smokeGoogleWorkspaceCli(),
    }),
  );

  let lastHeartbeat = Date.now();
  for (;;) {
    await runTaskLoopOnce({
      api,
      workspaceRoot: env.WORKSPACE_ROOT,
      idleDelayMs: env.TASK_IDLE_DELAY_MS,
    });
    if (Date.now() - lastHeartbeat >= env.HEARTBEAT_INTERVAL_MS) {
      await api.heartbeat({
        runtimeStatus: "running",
        runtimeVersion: env.RUNTIME_VERSION,
        workspaceRoot: env.WORKSPACE_ROOT,
      });
      lastHeartbeat = Date.now();
    }
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(async (err) => {
    console.error(
      JSON.stringify({
        level: "error",
        event: "computer_runtime_crashed",
        message: err instanceof Error ? err.message : String(err),
      }),
    );
    process.exit(1);
  });
}
