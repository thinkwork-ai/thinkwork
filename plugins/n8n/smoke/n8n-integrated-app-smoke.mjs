#!/usr/bin/env node
/**
 * n8n integrated app smoke.
 *
 * Dry-run is the default. Set SMOKE_ENABLE_N8N_INTEGRATED_APP=1 after the n8n
 * plugin is installed and deployed through ThinkWork to verify the user-facing
 * app path, workflow rows, execution rows, and optional bridge-linked evidence.
 */

import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "../../../scripts/smoke/deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_N8N_INTEGRATED_APP === "1";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const thinkworkUrl = first(
  env.SMOKE_THINKWORK_URL,
  env.THINKWORK_PUBLIC_URL,
  env.THINKWORK_WEB_URL,
);
const graphqlUrl = first(
  env.SMOKE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
  thinkworkUrl ? new URL("/graphql", thinkworkUrl).toString() : null,
);
const installId = first(env.SMOKE_N8N_INSTALL_ID, env.N8N_PLUGIN_INSTALL_ID);
const requiredBridgeThreadId = first(env.SMOKE_N8N_BRIDGE_THREAD_ID);

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "n8n-integrated-app",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_N8N_INTEGRATED_APP=1 to run the deployed n8n integrated app smoke",
          dryRun: {
            route: "/apps/n8n/workflows",
            requiredWhenRunning: [
              "n8n plugin installed through Settings -> Plugins",
              "managed n8n app deployed and ready",
              "tenant n8n-api credential configured server-side",
              "operator GraphQL auth for installedPluginApps and n8nAppData",
            ],
            optionalInputs: [
              "SMOKE_N8N_INSTALL_ID to pin the app data query",
              "SMOKE_N8N_BRIDGE_THREAD_ID to require bridge-linked execution evidence",
            ],
            verifies: [
              "installedPluginApps returns n8n-workflow-operations at /apps/n8n/workflows",
              "n8nAppData returns workflow table readiness and rows",
              "n8nAppData returns bounded execution table readiness and rows",
              "bridge-linked execution evidence is present when requested",
              "smoke output contains counts and readiness only, not raw execution payloads or credentials",
            ],
          },
        },
        env,
      ),
      null,
      2,
    ),
  );
  process.exit(0);
}

try {
  const result = await runLiveSmoke();
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "n8n-integrated-app",
        { ok: true, ...result },
        env,
      ),
      null,
      2,
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function runLiveSmoke() {
  if (!graphqlUrl) {
    throw new Error(
      "Set SMOKE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, API_GRAPHQL_URL, or SMOKE_THINKWORK_URL.",
    );
  }
  const headers = authHeaders();
  if (Object.keys(headers).length === 0) {
    throw new Error(
      "Set SMOKE_COGNITO_ID_TOKEN, COGNITO_ID_TOKEN, API_AUTH_SECRET, THINKWORK_API_SECRET, GRAPHQL_API_KEY, or VITE_GRAPHQL_API_KEY.",
    );
  }

  const apps = await gql(
    `query N8nIntegratedAppInstalledApps {
      installedPluginApps {
        pluginInstallId
        pluginKey
        appKey
        routeSegment
        readiness { state message nextAction }
      }
    }`,
    {},
    headers,
  );
  const app = apps.installedPluginApps.find(
    (candidate) =>
      candidate.pluginKey === "n8n" &&
      candidate.appKey === "n8n-workflow-operations" &&
      candidate.routeSegment === "workflows",
  );
  if (!app) {
    throw new Error("n8n Workflows app is not available to this account.");
  }

  const targetInstallId = installId || app.pluginInstallId;
  if (!targetInstallId) {
    throw new Error("n8n app did not include a pluginInstallId.");
  }

  const data = await gql(
    `query N8nIntegratedAppData($installId: ID!, $executionLimit: Int) {
      n8nAppData(installId: $installId, executionLimit: $executionLimit) {
        workflowReadinessState
        executionReadinessState
        nativeBaseUrl
        workflows {
          externalWorkflowId
          name
          readinessState
          nativeWorkflowUrl
          warnings
        }
        executions {
          externalExecutionId
          externalWorkflowId
          status
          nativeExecutionUrl
          warnings
          bridgeRuns { id threadId status resumeStatus }
        }
      }
    }`,
    { installId: targetInstallId, executionLimit: 25 },
    headers,
  );
  const appData = data.n8nAppData;
  const bridgeLinkedExecutions = appData.executions.filter(
    (execution) => execution.bridgeRuns.length > 0,
  );

  if (requiredBridgeThreadId) {
    const matched = bridgeLinkedExecutions.some((execution) =>
      execution.bridgeRuns.some(
        (run) => run.threadId === requiredBridgeThreadId,
      ),
    );
    if (!matched) {
      throw new Error(
        "No bridge-linked execution matched SMOKE_N8N_BRIDGE_THREAD_ID.",
      );
    }
  }

  return {
    route: "/apps/n8n/workflows",
    installedApp: {
      pluginInstallId: app.pluginInstallId,
      readiness: app.readiness,
    },
    appData: {
      nativeBaseUrl: appData.nativeBaseUrl,
      workflowReadinessState: appData.workflowReadinessState,
      executionReadinessState: appData.executionReadinessState,
      workflowCount: appData.workflows.length,
      executionCount: appData.executions.length,
      bridgeLinkedExecutionCount: bridgeLinkedExecutions.length,
      sampleWorkflowIds: appData.workflows
        .slice(0, 3)
        .map((workflow) => workflow.externalWorkflowId),
      sampleExecutionIds: appData.executions
        .slice(0, 3)
        .map((execution) => execution.externalExecutionId),
    },
  };
}

async function gql(query, variables, headers) {
  const response = await fetch(graphqlUrl, {
    method: "POST",
    headers: {
      accept: "application/json",
      "content-type": "application/json",
      ...headers,
    },
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json().catch(() => ({}));
  if (!response.ok || payload.errors?.length) {
    throw new Error(
      `GraphQL request failed: HTTP ${response.status} ${redact(
        JSON.stringify(payload.errors ?? payload).slice(0, 500),
      )}`,
    );
  }
  return payload.data;
}

function authHeaders() {
  const idToken = first(env.SMOKE_COGNITO_ID_TOKEN, env.COGNITO_ID_TOKEN);
  if (idToken) return { authorization: `Bearer ${idToken}` };
  const authSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
  if (authSecret) return { "x-api-secret": authSecret };
  const apiKey = first(env.VITE_GRAPHQL_API_KEY, env.GRAPHQL_API_KEY);
  if (apiKey) return { "x-api-key": apiKey };
  return {};
}

function loadEnvFile() {
  const envPath = process.env.SMOKE_ENV_FILE || ".env";
  const resolved = path.resolve(envPath);
  if (!fs.existsSync(resolved)) return {};
  const values = {};
  for (const line of fs.readFileSync(resolved, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#") || !trimmed.includes("=")) {
      continue;
    }
    const [key, ...rest] = trimmed.split("=");
    values[key] = rest.join("=").replace(/^['"]|['"]$/g, "");
  }
  return values;
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== "") ?? null;
}

function fail(message) {
  console.error(redact(message));
  process.exit(1);
}

function redact(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/(api[_-]?key|token|secret|credential)["=: ]+[^",\s]+/gi, "$1=[redacted]")
    .replace(/https?:\/\/[^"\s]+\/webhook\/[^"\s]+/gi, "[redacted-webhook-url]");
}
