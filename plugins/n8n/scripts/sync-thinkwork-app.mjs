#!/usr/bin/env node
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { pathToFileURL } from "node:url";

const DEFAULT_APP_DIR = "plugins/n8n/n8n-app";
const DEFAULT_APP_ROUTE = "/apps/n8n/workflows";

function parseArgs(argv) {
  const args = {
    appDir: process.env.N8N_THINKWORK_APP_DIR || DEFAULT_APP_DIR,
    route: process.env.N8N_THINKWORK_APP_ROUTE || DEFAULT_APP_ROUTE,
    dryRun: process.env.N8N_THINKWORK_APP_SYNC_DRY_RUN !== "0",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--app-dir") {
      args.appDir = requireValue(argv, ++index, arg);
    } else if (arg === "--url" || arg === "--thinkwork-url") {
      args.url = requireValue(argv, ++index, arg);
    } else if (arg === "--install-id") {
      args.installId = requireValue(argv, ++index, arg);
    } else if (arg === "--api-key") {
      args.apiKey = requireValue(argv, ++index, arg);
    } else if (arg === "--auth-secret") {
      args.authSecret = requireValue(argv, ++index, arg);
    } else if (arg === "--id-token") {
      args.idToken = requireValue(argv, ++index, arg);
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.dryRun = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.url ||= first(
    process.env.THINKWORK_PUBLIC_URL,
    process.env.THINKWORK_WEB_URL,
    process.env.SMOKE_THINKWORK_URL,
  );
  args.apiKey ||= first(
    process.env.VITE_GRAPHQL_API_KEY,
    process.env.GRAPHQL_API_KEY,
  );
  args.authSecret ||= first(
    process.env.API_AUTH_SECRET,
    process.env.THINKWORK_API_SECRET,
  );
  args.idToken ||= first(
    process.env.SMOKE_COGNITO_ID_TOKEN,
    process.env.COGNITO_ID_TOKEN,
  );
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

export function validateN8nAppPackage(appDir = DEFAULT_APP_DIR) {
  const required = [
    "README.md",
    "package.json",
    "tsconfig.json",
    "src/application-config.ts",
    "src/front-components/thinkwork-workflows.front-component.tsx",
    "src/lib/n8n-app-data.ts",
  ];
  const missing = required.filter((relativePath) => {
    return !fs.existsSync(path.resolve(appDir, relativePath));
  });
  if (missing.length > 0) {
    throw new Error(`Missing n8n app package file(s): ${missing.join(", ")}`);
  }
  return {
    appDir,
    required,
    packageName: JSON.parse(
      fs.readFileSync(path.resolve(appDir, "package.json"), "utf8"),
    ).name,
  };
}

export function buildN8nAppSyncPlan(args) {
  const packageStatus = validateN8nAppPackage(args.appDir);
  return {
    app: "n8n Workflows",
    mode: args.dryRun ? "dry-run" : "apply",
    appDir: packageStatus.appDir,
    packageName: packageStatus.packageName,
    route: args.route,
    thinkworkUrl: args.url ? normalizeUrl(args.url) : null,
    installId: args.installId ?? null,
    dryRun: args.dryRun
      ? {
          mutates: false,
          verifies: [
            "local n8n app package files exist",
            "ThinkWork app route is /apps/n8n/workflows",
            "apply prerequisites are known",
          ],
          requiredForApply: [
            "THINKWORK_PUBLIC_URL or --thinkwork-url",
            "one GraphQL credential: API_AUTH_SECRET, GRAPHQL_API_KEY, or COGNITO_ID_TOKEN",
            "optional SMOKE_N8N_INSTALL_ID or --install-id for n8nAppData verification",
          ],
        }
      : null,
  };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const plan = buildN8nAppSyncPlan(args);

  if (args.dryRun) {
    printJson({
      ok: true,
      ...plan,
      note:
        "Dry run validates the package and apply prerequisites without publishing, installing, or mutating n8n.",
    });
    return;
  }

  if (!args.url) {
    throw new Error("Set THINKWORK_PUBLIC_URL or pass --thinkwork-url.");
  }
  if (!args.apiKey && !args.authSecret && !args.idToken) {
    throw new Error(
      "Set API_AUTH_SECRET, THINKWORK_API_SECRET, GRAPHQL_API_KEY, COGNITO_ID_TOKEN, or pass --api-key/--auth-secret/--id-token.",
    );
  }

  const graphqlUrl = graphqlEndpoint(args.url);
  const installedApps = await gql(
    graphqlUrl,
    authHeaders(args),
    `query N8nInstalledApps {
      installedPluginApps {
        pluginInstallId
        pluginKey
        appKey
        routeSegment
        readiness { state message nextAction }
      }
    }`,
    {},
  );
  const n8nApp = installedApps.installedPluginApps.find(
    (app) =>
      app.pluginKey === "n8n" &&
      app.appKey === "n8n-workflow-operations" &&
      app.routeSegment === "workflows",
  );
  if (!n8nApp) {
    throw new Error("n8n Workflows app is not returned by installedPluginApps.");
  }

  let appData = null;
  const installId = args.installId || n8nApp.pluginInstallId;
  if (installId) {
    appData = await gql(
      graphqlUrl,
      authHeaders(args),
      `query N8nSyncAppData($installId: ID!, $executionLimit: Int) {
        n8nAppData(installId: $installId, executionLimit: $executionLimit) {
          workflowReadinessState
          executionReadinessState
          workflows { externalWorkflowId }
          executions { externalExecutionId bridgeRuns { id threadId } }
        }
      }`,
      { installId, executionLimit: 25 },
    );
  }

  printJson({
    ok: true,
    ...plan,
    note:
      "Apply verified the deployed ThinkWork-hosted n8n app contract. It did not mutate n8n workflows or ThinkWork plugin settings.",
    graphqlUrl,
    installedApp: n8nApp,
    appData: appData
      ? {
          workflowReadinessState: appData.n8nAppData.workflowReadinessState,
          executionReadinessState: appData.n8nAppData.executionReadinessState,
          workflowCount: appData.n8nAppData.workflows.length,
          executionCount: appData.n8nAppData.executions.length,
          bridgeLinkedExecutionCount: appData.n8nAppData.executions.filter(
            (execution) => execution.bridgeRuns.length > 0,
          ).length,
        }
      : null,
  });
}

async function gql(url, headers, query, variables) {
  const response = await fetch(url, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      accept: "application/json",
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

function authHeaders(args) {
  if (args.idToken) return { authorization: `Bearer ${args.idToken}` };
  if (args.authSecret) return { "x-api-secret": args.authSecret };
  if (args.apiKey) return { "x-api-key": args.apiKey };
  return {};
}

function graphqlEndpoint(baseUrl) {
  return new URL("/graphql", normalizeUrl(baseUrl)).toString();
}

function normalizeUrl(value) {
  const parsed = new URL(value);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`ThinkWork URL must be HTTPS or localhost, got ${value}.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function first(...values) {
  return values.find((value) => value !== undefined && value !== "") ?? null;
}

function printJson(value) {
  console.log(redact(JSON.stringify(value, null, 2)));
}

function redact(value) {
  return value
    .replace(/Bearer\s+[A-Za-z0-9._~+/=-]+/g, "Bearer [redacted]")
    .replace(/"x-api-key"\s*:\s*"[^"]+"/gi, '"x-api-key":"[redacted]"')
    .replace(/"x-api-secret"\s*:\s*"[^"]+"/gi, '"x-api-secret":"[redacted]"')
    .replace(/(api[_-]?key|token|secret|credential)["=: ]+[^",\s]+/gi, "$1=[redacted]");
}

if (import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(redact(error instanceof Error ? error.message : String(error)));
    process.exit(1);
  });
}
