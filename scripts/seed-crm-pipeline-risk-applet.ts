import { readFile } from "node:fs/promises";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const APP_ID = "33333333-3333-4333-8333-333333333333";
const APP_NAME = "LastMile CRM pipeline risk";
const SCRIPT_DIR = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(SCRIPT_DIR, "..");
const SOURCE_PATH = resolve(
  REPO_ROOT,
  "apps/computer/src/test/fixtures/crm-pipeline-risk-applet/source.tsx",
);
const METADATA_PATH = resolve(
  REPO_ROOT,
  "apps/computer/src/test/fixtures/crm-pipeline-risk-applet/metadata.json",
);

const LOOKUP_QUERY = `
query SeedCrmPipelineRiskAppletLookup($appId: ID!) {
  applet(appId: $appId) {
    applet {
      appId
      version
    }
  }
}
`;

const SAVE_MUTATION = `
mutation SeedCrmPipelineRiskApplet($input: SaveAppletInput!) {
  saveApplet(input: $input) {
    ok
    appId
    version
    validated
    persisted
    errors
  }
}
`;

const REGENERATE_MUTATION = `
mutation RegenerateSeededCrmPipelineRiskApplet($input: SaveAppletInput!) {
  regenerateApplet(input: $input) {
    ok
    appId
    version
    validated
    persisted
    errors
  }
}
`;

async function main() {
  const args = new Set(process.argv.slice(2));
  const dryRun = args.has("--dry-run");
  const endpoint = env("THINKWORK_API_URL", dryRun);
  const apiSecret = env("API_AUTH_SECRET", dryRun);
  const tenantId = env("TENANT_ID", dryRun);
  const agentId = process.env.AGENT_ID || "crm-pipeline-risk-seeder";
  const computerId = process.env.COMPUTER_ID || "crm-pipeline-risk-seeder";
  const source = await readFile(SOURCE_PATH, "utf8");
  const metadata = JSON.parse(await readFile(METADATA_PATH, "utf8"));
  const variables = {
    input: {
      appId: APP_ID,
      name: APP_NAME,
      files: { "App.tsx": source },
      metadata,
    },
  };

  if (dryRun) {
    console.log(
      JSON.stringify(
        {
          endpoint: endpoint ? graphqlEndpoint(endpoint) : null,
          tenantId: tenantId || null,
          agentId,
          computerId,
          variables,
        },
        null,
        2,
      ),
    );
    return;
  }

  const headers = {
    "content-type": "application/json",
    authorization: `Bearer ${apiSecret}`,
    "x-tenant-id": tenantId,
    "x-agent-id": agentId,
    "x-computer-id": computerId,
  };
  const existing = await graphql(endpoint, headers, LOOKUP_QUERY, {
    appId: APP_ID,
  });
  const exists = !!existing.data?.applet?.applet?.appId;
  const payload = await graphql(
    endpoint,
    headers,
    exists ? REGENERATE_MUTATION : SAVE_MUTATION,
    variables,
  );
  const result = exists
    ? payload.data?.regenerateApplet
    : payload.data?.saveApplet;
  if (!result?.ok) {
    console.error(JSON.stringify(result ?? payload, null, 2));
    process.exit(1);
  }
  console.log(JSON.stringify(result, null, 2));
}

function env(name: string, optional = false) {
  const value = process.env[name]?.trim();
  if (!value && !optional) {
    throw new Error(`${name} is required`);
  }
  return value || "";
}

function graphqlEndpoint(apiUrl: string) {
  const normalized = apiUrl.replace(/\/+$/, "");
  return normalized.endsWith("/graphql") ? normalized : `${normalized}/graphql`;
}

async function graphql(
  endpoint: string,
  headers: Record<string, string>,
  query: string,
  variables: Record<string, unknown>,
) {
  const response = await fetch(graphqlEndpoint(endpoint), {
    method: "POST",
    headers,
    body: JSON.stringify({ query, variables }),
  });
  const payload = await response.json();
  if (!response.ok || payload.errors?.length) {
    console.error(JSON.stringify(payload, null, 2));
    process.exit(1);
  }
  return payload;
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
