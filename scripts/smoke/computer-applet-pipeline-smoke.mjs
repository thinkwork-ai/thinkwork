#!/usr/bin/env node
/**
 * Smoke test the deployed Computer applet pipeline.
 *
 * Scenarios:
 *   A1. Service writer path persists source + metadata and returns
 *       validated/persisted pins.
 *   A2. Deployed apps/computer can serve /artifacts/:id for a saved applet.
 *   A3. A returned applet source's deterministic refresh() export can be
 *       invoked and returns per-source statuses.
 *   A4. Applet state writes and reads back through the host API GraphQL path.
 *   A5. The canonical LastMile CRM applet fixture is seeded and opens through
 *       the same applet route, replacing the legacy dashboard smoke path.
 *
 * Required env:
 *   DATABASE_URL
 *   API_AUTH_SECRET
 *   SMOKE_COMPUTER_URL
 *   VITE_GRAPHQL_HTTP_URL, GRAPHQL_HTTP_URL, or API_GRAPHQL_URL
 */

import { execFileSync } from "node:child_process";
import crypto from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";

const env = {
  ...loadEnvFile(),
  ...process.env,
};

const databaseUrl = env.DATABASE_URL;
const apiUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const computerUrl = first(env.SMOKE_COMPUTER_URL, env.COMPUTER_URL);
const smokeAppletId =
  env.SMOKE_APPLET_ID || "44444444-4444-4444-8444-444444444444";
const crmAppletId =
  env.SMOKE_CRM_APPLET_ID || "33333333-3333-4333-8333-333333333333";

if (!databaseUrl) fail("Missing DATABASE_URL.");
if (!apiUrl || !apiSecret) {
  fail("Missing GraphQL HTTP config or API_AUTH_SECRET.");
}
if (!computerUrl) fail("Missing SMOKE_COMPUTER_URL.");

const identity = resolveComputerIdentity(env);

const smokeSource = `export default function SmokeApplet() {
  return null;
}

export async function refresh() {
  return {
    data: { refreshed: true, label: "computer-applet-smoke" },
    sourceStatuses: {
      crm: "success",
      email: "partial",
      calendar: "success"
    },
    errors: []
  };
}
`;

try {
  const smokeApplet = await saveOrRegenerateApplet({
    appId: smokeAppletId,
    name: "Computer applet smoke",
    source: smokeSource,
    metadata: {
      prompt: "Smoke-test the deployed Computer applet pipeline.",
      agentVersion: "computer-applet-smoke-u14",
      modelId: "smoke",
    },
  });
  const loadedSmokeApplet = await loadApplet(smokeApplet.appId);
  const openPath = await verifyOpenPath(smokeApplet.appId);
  const refresh = await verifyRefreshContract(loadedSmokeApplet.source);
  const state = await verifyAppletState(smokeApplet.appId);
  const crm = await verifyCrmAppletCutover();

  console.log(
    JSON.stringify(
      {
        ok: true,
        tenantId: identity.tenantId,
        computerId: identity.computerId,
        userId: identity.userId,
        applet: {
          appId: smokeApplet.appId,
          version: smokeApplet.version,
          validated: smokeApplet.validated,
          persisted: smokeApplet.persisted,
          sourceBytes: loadedSmokeApplet.source.length,
        },
        openPath,
        refresh,
        state,
        crm,
      },
      null,
      2,
    ),
  );
} catch (error) {
  fail(error instanceof Error ? error.message : String(error));
}

async function saveOrRegenerateApplet({ appId, name, source, metadata }) {
  const exists = appletExists(appId);
  const data = await gql(
    exists
      ? `
        mutation RegenerateSmokeApplet($input: SaveAppletInput!) {
          regenerateApplet(input: $input) {
            ok
            appId
            version
            validated
            persisted
            errors
          }
        }
      `
      : `
        mutation SaveSmokeApplet($input: SaveAppletInput!) {
          saveApplet(input: $input) {
            ok
            appId
            version
            validated
            persisted
            errors
          }
        }
      `,
    {
      input: {
        appId,
        name,
        files: { "App.tsx": source },
        metadata: {
          ...metadata,
          appId,
          name,
          tenantId: identity.tenantId,
          threadId: metadata.threadId,
        },
      },
    },
  );
  const result = exists ? data.regenerateApplet : data.saveApplet;
  if (!result?.ok || !result.validated || !result.persisted) {
    throw new Error(
      `Applet save did not return ok/validated/persisted pins: ${JSON.stringify(result)}`,
    );
  }
  return result;
}

function appletExists(appId) {
  const count = Number(
    psql(`
      select count(*)
      from artifacts
      where id = '${String(appId).replace(/'/g, "''")}'::uuid
        and tenant_id = '${String(identity.tenantId).replace(/'/g, "''")}'::uuid
        and lower(type) = 'applet'
    `) || "0",
  );
  return count > 0;
}

async function loadApplet(appId) {
  const data = await gql(
    `
      query SmokeApplet($appId: ID!) {
        applet(appId: $appId) {
          applet {
            appId
            name
            version
            generatedAt
            stdlibVersionAtGeneration
          }
          source
          metadata
        }
      }
    `,
    { appId },
  );
  const payload = data.applet;
  if (!payload?.applet?.appId || !payload.source) {
    throw new Error(`applet(${appId}) did not return source + metadata.`);
  }
  return payload;
}

async function verifyOpenPath(appId) {
  const url = `${computerUrl.replace(/\/+$/, "")}/artifacts/${appId}`;
  const response = await fetch(url, { redirect: "manual" });
  const body = await response.text();
  const contentType = response.headers.get("content-type") || "";
  if (response.status !== 200) {
    throw new Error(`/artifacts/${appId} returned HTTP ${response.status}.`);
  }
  if (
    !contentType.includes("text/html") ||
    !body.includes("<title>ThinkWork</title>")
  ) {
    throw new Error(
      `/artifacts/${appId} did not return the Computer SPA shell.`,
    );
  }
  return { url, status: response.status, contentType };
}

async function verifyRefreshContract(source) {
  const moduleUrl = `data:text/javascript;base64,${Buffer.from(source).toString("base64")}`;
  const mod = await import(moduleUrl);
  if (typeof mod.refresh !== "function") {
    throw new Error("Smoke applet source does not export refresh().");
  }
  const result = await mod.refresh();
  if (!result?.data?.refreshed) {
    throw new Error(
      `refresh() returned unexpected data: ${JSON.stringify(result)}`,
    );
  }
  const statuses = result.sourceStatuses || {};
  for (const sourceId of ["crm", "email", "calendar"]) {
    if (!statuses[sourceId]) {
      throw new Error(`refresh() missing source status for ${sourceId}.`);
    }
  }
  return {
    invoked: true,
    statusCount: Object.keys(statuses).length,
    sourceStatuses: statuses,
  };
}

async function verifyAppletState(appId) {
  const instanceId = `smoke-${crypto.randomUUID()}`;
  const key = "u14-smoke-state";
  const value = {
    saved: true,
    marker: `smoke-${Date.now()}`,
  };
  const saved = await gql(
    `
      mutation SaveAppletState($input: SaveAppletStateInput!) {
        saveAppletState(input: $input) {
          appId
          instanceId
          key
          value
          updatedAt
        }
      }
    `,
    { input: { appId, instanceId, key, value } },
  );
  if (saved.saveAppletState?.value?.marker !== value.marker) {
    throw new Error("saveAppletState did not echo the saved marker.");
  }

  const loaded = await gql(
    `
      query AppletState($appId: ID!, $instanceId: ID!, $key: String!) {
        appletState(appId: $appId, instanceId: $instanceId, key: $key) {
          appId
          instanceId
          key
          value
          updatedAt
        }
      }
    `,
    { appId, instanceId, key },
  );
  if (loaded.appletState?.value?.marker !== value.marker) {
    throw new Error("appletState did not return the persisted marker.");
  }
  return { appId, instanceId, key, persisted: true };
}

async function verifyCrmAppletCutover() {
  const sourcePath = path.join(
    "apps",
    "computer",
    "src",
    "test",
    "fixtures",
    "crm-pipeline-risk-applet",
    "source.tsx",
  );
  const metadataPath = path.join(
    "apps",
    "computer",
    "src",
    "test",
    "fixtures",
    "crm-pipeline-risk-applet",
    "metadata.json",
  );
  const source = fs.readFileSync(sourcePath, "utf8");
  const fixtureMetadata = JSON.parse(fs.readFileSync(metadataPath, "utf8"));
  const applet = await saveOrRegenerateApplet({
    appId: crmAppletId,
    name: fixtureMetadata.name,
    source,
    metadata: {
      ...fixtureMetadata,
      prompt: fixtureMetadata.prompt,
      agentVersion: fixtureMetadata.agentVersion,
      modelId: fixtureMetadata.modelId,
    },
  });
  const loaded = await loadApplet(applet.appId);
  if (!loaded.source.includes("LastMile CRM pipeline risk")) {
    throw new Error(
      "Seeded CRM applet source does not contain the CRM fixture title.",
    );
  }
  if (!loaded.source.includes("export async function refresh")) {
    throw new Error("Seeded CRM applet no longer exports refresh().");
  }
  const openPath = await verifyOpenPath(applet.appId);
  return {
    appId: applet.appId,
    version: applet.version,
    validated: applet.validated,
    persisted: applet.persisted,
    openPath,
  };
}

async function gql(query, variables) {
  const response = await fetch(apiUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiSecret}`,
      "x-tenant-id": identity.tenantId,
      "x-principal-id": identity.userId,
      "x-agent-id": identity.agentId || identity.computerId,
      "x-computer-id": identity.computerId,
    },
    body: JSON.stringify({ query, variables }),
  });
  if (!response.ok) {
    throw new Error(
      `GraphQL HTTP ${response.status}: ${await response.text()}`,
    );
  }
  const body = await response.json();
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

function resolveComputerIdentity(source) {
  const supplied = {
    tenantId: first(source.SMOKE_TENANT_ID, source.TENANT_ID),
    computerId: first(source.SMOKE_COMPUTER_ID, source.COMPUTER_ID),
    userId: first(source.SMOKE_USER_ID, source.USER_ID),
    agentId: first(source.SMOKE_AGENT_ID, source.AGENT_ID),
  };
  if (supplied.tenantId && supplied.computerId && supplied.userId) {
    return supplied;
  }

  const row = psql(`
    select
      c.tenant_id::text || '|' ||
      c.id::text || '|' ||
      c.owner_user_id::text || '|' ||
      coalesce(c.migrated_from_agent_id::text, '')
    from computers c
    where c.owner_user_id is not null
    order by c.updated_at desc nulls last, c.created_at desc
    limit 1
  `);
  const [tenantId, computerId, userId, agentId] = row.split("|");
  if (!tenantId || !computerId || !userId) {
    fail(
      "Could not resolve a Computer identity. Set SMOKE_TENANT_ID, SMOKE_COMPUTER_ID, and SMOKE_USER_ID.",
    );
  }
  return { tenantId, computerId, userId, agentId: agentId || null };
}

function psql(sql) {
  return execFileSync("psql", [databaseUrl, "-tAc", sql], {
    encoding: "utf8",
  }).trim();
}

function loadEnvFile() {
  const configured = process.env.COMPUTER_ENV_FILE;
  if (configured === "none") return {};

  const envFile = configured || path.join("apps", "computer", ".env");
  if (!fs.existsSync(envFile)) return {};

  return Object.fromEntries(
    fs
      .readFileSync(envFile, "utf8")
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter((line) => line && !line.startsWith("#"))
      .map((line) => {
        const index = line.indexOf("=");
        if (index < 0) return [line, ""];
        return [line.slice(0, index), unquote(line.slice(index + 1))];
      }),
  );
}

function unquote(value) {
  if (
    (value.startsWith('"') && value.endsWith('"')) ||
    (value.startsWith("'") && value.endsWith("'"))
  ) {
    return value.slice(1, -1);
  }
  return value;
}

function first(...values) {
  return values.find((value) => typeof value === "string" && value.length > 0);
}

function fail(message) {
  console.error(`FAIL: ${message}`);
  process.exit(1);
}
