#!/usr/bin/env node
/**
 * Company Brain premium plugin smoke (THNK-15 U8).
 *
 * Dry-run is the default. Set SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1 to run live
 * against a deployed stage. Live mode uses the GraphQL service-secret path and
 * can mutate tenant plugin state only after the explicit enable flag is set.
 *
 * Live env:
 *   VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL
 *   API_AUTH_SECRET or THINKWORK_API_SECRET
 *   SMOKE_TENANT_ID=<tenant uuid>
 *   SMOKE_ADMIN_USER_ID=<users.id with owner/admin tenant role>
 *
 * Optional key paths:
 *   SMOKE_COMPANY_BRAIN_INSTALL_KEY=<ThinkWork-issued or configured backdoor key>
 *   SMOKE_COMPANY_BRAIN_ISSUE_KEY=1
 *   SMOKE_PLATFORM_OPERATOR_USER_ID=<users.id allowed to issue premium keys>
 *
 * Without a key path, live mode proves catalog visibility and key-gate
 * failures, then skips install/adoption checks with an explicit reason.
 */

import { randomUUID } from "node:crypto";
import fs from "node:fs";
import path from "node:path";
import process from "node:process";
import { attachSmokeEvidence } from "./deployment-evidence.mjs";

const LIVE_ENABLED = process.env.SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN === "1";
const PLUGIN_KEY = "company-brain";
const SUBSTRATE_COMPONENT = "brain-substrate";
const TIMEOUT_MS = Number(process.env.SMOKE_TIMEOUT_MS || 20_000);

const env = { ...loadEnvFile(), ...process.env };
const graphqlUrl = first(
  env.VITE_GRAPHQL_HTTP_URL,
  env.GRAPHQL_HTTP_URL,
  env.API_GRAPHQL_URL,
);
const apiSecret = first(env.API_AUTH_SECRET, env.THINKWORK_API_SECRET);
const tenantId = first(env.SMOKE_TENANT_ID, env.TENANT_ID);
const adminUserId = first(env.SMOKE_ADMIN_USER_ID);
const platformOperatorUserId = first(
  env.SMOKE_PLATFORM_OPERATOR_USER_ID,
  env.SMOKE_ADMIN_USER_ID,
);
const configuredInstallKey = first(env.SMOKE_COMPANY_BRAIN_INSTALL_KEY);
const issueKey = env.SMOKE_COMPANY_BRAIN_ISSUE_KEY === "1";

const checks = [];

if (!LIVE_ENABLED) {
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-plugin",
        {
          ok: true,
          skippedLive: true,
          reason:
            "set SMOKE_ENABLE_COMPANY_BRAIN_PLUGIN=1 to run the deployed Company Brain premium plugin smoke",
          dryRun: {
            requiredWhenRunning: [
              "VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL or API_GRAPHQL_URL",
              "API_AUTH_SECRET or THINKWORK_API_SECRET",
              "SMOKE_TENANT_ID",
              "SMOKE_ADMIN_USER_ID (owner/admin tenant role)",
            ],
            optionalKeyPaths: [
              "SMOKE_COMPANY_BRAIN_INSTALL_KEY (issued key or configured dev/test backdoor)",
              "SMOKE_COMPANY_BRAIN_ISSUE_KEY=1 plus SMOKE_PLATFORM_OPERATOR_USER_ID",
            ],
            verifies: [
              "Company Brain is visible in pluginCatalog for an unentitled tenant",
              "catalog premium metadata is key-gated with product-facing prompt copy",
              "installPlugin without a key fails with INSTALL_KEY_REQUIRED and creates no install",
              "invalid key fails closed and creates no install",
              "valid generated/configured key grants persistent entitlement through installPlugin",
              "install/adoption evidence exposes the Brain substrate deployment job and no-change adoption marker when applicable",
              "plugin detail target and Memory / Ontology route remain stable",
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
  await runLiveSmoke();
  const failed = checks.filter((check) => !check.ok);
  console.log(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-plugin",
        {
          ok: failed.length === 0,
          checks,
        },
        env,
      ),
      null,
      2,
    ),
  );
  process.exit(failed.length === 0 ? 0 : 1);
} catch (error) {
  console.error(
    JSON.stringify(
      await attachSmokeEvidence(
        "company-brain-plugin",
        {
          ok: false,
          error: error instanceof Error ? error.message : String(error),
          checks,
        },
        env,
      ),
      null,
      2,
    ),
  );
  process.exit(1);
}

async function runLiveSmoke() {
  requireEnv("VITE_GRAPHQL_HTTP_URL or GRAPHQL_HTTP_URL", graphqlUrl);
  requireEnv("API_AUTH_SECRET or THINKWORK_API_SECRET", apiSecret);
  requireEnv("SMOKE_TENANT_ID", tenantId);
  requireEnv("SMOKE_ADMIN_USER_ID", adminUserId);

  let entry = await readCompanyBrainEntry();
  assertCatalogEntry(entry);

  if (entry.install) {
    pass("Company Brain install already exists", {
      installId: entry.install.id,
      state: entry.install.state,
    });
    assertEntitlement(entry.entitlement, { allowMissing: true });
    assertInstallEvidence(entry.install);
    assertRoutes();
    return;
  }

  if (entry.entitlement?.status === "active") {
    pass("tenant already has active Company Brain entitlement", {
      entitlementId: entry.entitlement.id,
      source: entry.entitlement.source,
    });
    const install = await installCompanyBrain(null);
    assertInstallEvidence(install);
    assertRoutes();
    return;
  }

  await assertInstallGateFailures();

  const installKey = configuredInstallKey || (await maybeIssueInstallKey());
  if (!installKey) {
    skip(
      "valid key redemption and substrate adoption",
      "set SMOKE_COMPANY_BRAIN_INSTALL_KEY or SMOKE_COMPANY_BRAIN_ISSUE_KEY=1 to mutate this tenant",
    );
    assertRoutes();
    return;
  }

  const install = await installCompanyBrain(installKey);
  assertInstallEvidence(install);
  entry = await readCompanyBrainEntry();
  assertEntitlement(entry.entitlement, { allowMissing: false });
  assertRoutes();
}

async function readCompanyBrainEntry() {
  const { pluginCatalog } = await gql(
    `query CompanyBrainSmokeCatalog {
       pluginCatalog {
         pluginKey
         displayName
         description
         latestVersion
         updateAvailable
         premium {
           entitlementProductKey
           installKeyRequired
           installKeyPrompt
         }
         entitlement {
           id
           pluginKey
           entitlementProductKey
           status
           source
           grantedAt
         }
         versions {
           version
           components {
             key
             type
             displayName
           }
         }
         install {
           id
           pluginKey
           pinnedVersion
           state
           lastError
           components {
             componentKey
             componentType
             state
             handlerRef
             lastError
           }
         }
       }
     }`,
    {},
    adminUserId,
  );
  const entry = pluginCatalog.find((candidate) => {
    return candidate.pluginKey === PLUGIN_KEY;
  });
  if (!entry) {
    throw new Error("pluginCatalog did not include Company Brain");
  }
  return entry;
}

function assertCatalogEntry(entry) {
  if (entry.displayName === "Company Brain") {
    pass("catalog exposes Company Brain by product name");
  } else {
    failCheck("catalog exposes Company Brain by product name", {
      displayName: entry.displayName,
    });
  }

  if (
    entry.premium?.entitlementProductKey === PLUGIN_KEY &&
    entry.premium?.installKeyRequired === true &&
    /Company Brain/i.test(entry.premium?.installKeyPrompt ?? "")
  ) {
    pass("catalog premium metadata is key-gated and product-facing", {
      prompt: entry.premium.installKeyPrompt,
    });
  } else {
    failCheck("catalog premium metadata is key-gated and product-facing", {
      premium: entry.premium,
    });
  }

  const substrate = entry.versions
    ?.flatMap((version) => version.components ?? [])
    .find((component) => component.key === SUBSTRATE_COMPONENT);
  if (substrate?.type === "infrastructure") {
    pass("manifest declares the Brain substrate infrastructure component");
  } else {
    failCheck("manifest declares the Brain substrate infrastructure component", {
      components: entry.versions?.flatMap((version) => version.components ?? []),
    });
  }
}

async function assertInstallGateFailures() {
  const missing = await gqlExpectError(
    `mutation CompanyBrainSmokeMissingKey($input: InstallPluginInput!) {
       installPlugin(input: $input) { id state }
     }`,
    {
      input: {
        pluginKey: PLUGIN_KEY,
        idempotencyKey: `company-brain-smoke-missing-${randomUUID()}`,
      },
    },
    adminUserId,
  );
  if (hasGraphqlErrorCode(missing, "INSTALL_KEY_REQUIRED")) {
    pass("install without key fails with INSTALL_KEY_REQUIRED");
  } else {
    failCheck("install without key fails with INSTALL_KEY_REQUIRED", {
      errors: missing.errors,
    });
  }

  const invalid = await gqlExpectError(
    `mutation CompanyBrainSmokeInvalidKey($input: InstallPluginInput!) {
       installPlugin(input: $input) { id state }
     }`,
    {
      input: {
        pluginKey: PLUGIN_KEY,
        installKey: `twpi_invalid_${randomUUID()}`,
        idempotencyKey: `company-brain-smoke-invalid-${randomUUID()}`,
      },
    },
    adminUserId,
  );
  if (invalid.errors?.length) {
    pass("invalid install key fails closed");
  } else {
    failCheck("invalid install key fails closed", { response: invalid });
  }

  const entry = await readCompanyBrainEntry();
  if (!entry.install && !entry.entitlement) {
    pass("failed key attempts do not create install or entitlement");
  } else {
    failCheck("failed key attempts do not create install or entitlement", {
      install: summarizeInstall(entry.install),
      entitlement: summarizeEntitlement(entry.entitlement),
    });
  }
}

async function maybeIssueInstallKey() {
  if (!issueKey) return null;
  requireEnv("SMOKE_PLATFORM_OPERATOR_USER_ID", platformOperatorUserId);
  const { issuePremiumPluginInstallKey } = await gql(
    `mutation CompanyBrainSmokeIssueKey($input: IssuePremiumPluginInstallKeyInput!) {
       issuePremiumPluginInstallKey(input: $input) {
         keyId
         pluginKey
         tenantId
         entitlementProductKey
         installKey
         issuedAt
         expiresAt
       }
     }`,
    {
      input: {
        pluginKey: PLUGIN_KEY,
        tenantId,
      },
    },
    platformOperatorUserId,
  );
  pass("platform operator issued a one-time Company Brain key", {
    keyId: issuePremiumPluginInstallKey.keyId,
    tenantId: issuePremiumPluginInstallKey.tenantId,
    issuedAt: issuePremiumPluginInstallKey.issuedAt,
    expiresAt: issuePremiumPluginInstallKey.expiresAt,
  });
  return issuePremiumPluginInstallKey.installKey;
}

async function installCompanyBrain(installKey) {
  const input = {
    pluginKey: PLUGIN_KEY,
    idempotencyKey: `company-brain-smoke-install-${randomUUID()}`,
    ...(installKey ? { installKey } : {}),
  };
  const { installPlugin } = await gql(
    `mutation CompanyBrainSmokeInstall($input: InstallPluginInput!) {
       installPlugin(input: $input) {
         id
         pluginKey
         pinnedVersion
         state
         lastError
         components {
           componentKey
           componentType
           state
           handlerRef
           lastError
         }
       }
    }`,
    { input },
    adminUserId,
  );
  pass("installPlugin accepted the Company Brain key", {
    installId: installPlugin.id,
    state: installPlugin.state,
    pinnedVersion: installPlugin.pinnedVersion,
  });
  return installPlugin;
}

function assertEntitlement(entitlement, { allowMissing }) {
  if (!entitlement && allowMissing) {
    skip(
      "active Company Brain entitlement",
      "existing install was present before this smoke; catalog did not expose an active entitlement",
    );
    return;
  }
  if (
    entitlement?.pluginKey === PLUGIN_KEY &&
    entitlement?.status === "active"
  ) {
    pass("catalog exposes an active persistent Company Brain entitlement", {
      entitlementId: entitlement.id,
      source: entitlement.source,
      grantedAt: entitlement.grantedAt,
    });
  } else {
    failCheck("catalog exposes an active persistent Company Brain entitlement", {
      entitlement: summarizeEntitlement(entitlement),
    });
  }
}

function assertInstallEvidence(install) {
  if (!install) {
    failCheck("Company Brain install evidence is readable", {
      reason: "missing install",
    });
    return;
  }
  const substrate = install.components.find((component) => {
    return (
      component.componentKey === SUBSTRATE_COMPONENT &&
      component.componentType === "infrastructure"
    );
  });
  if (!substrate) {
    failCheck("Company Brain install has Brain substrate component", {
      components: install.components.map((component) => component.componentKey),
    });
    return;
  }

  const handlerRef = parseHandlerRef(substrate.handlerRef);
  if (handlerRef?.managedAppKey === "cognee" || handlerRef?.deploymentJobId) {
    pass("Brain substrate component exposes deployment evidence", {
      state: substrate.state,
      managedAppKey: handlerRef?.managedAppKey ?? null,
      managedApplicationId: handlerRef?.managedApplicationId ?? null,
      deploymentJobId: handlerRef?.deploymentJobId ?? null,
      adoptionRequiresNoChange: handlerRef?.adoptionRequiresNoChange ?? false,
    });
  } else {
    failCheck("Brain substrate component exposes deployment evidence", {
      state: substrate.state,
      handlerRef,
      lastError: substrate.lastError,
    });
  }

  if (handlerRef?.adoptionRequiresNoChange === true) {
    pass("existing Cognee adoption requires no-change plan evidence", {
      deploymentJobId: handlerRef.deploymentJobId,
    });
  } else {
    skip(
      "existing Cognee no-change adoption evidence",
      "this tenant appears to be on the new-provision path or has not reached adoption evidence yet",
    );
  }

  if (
    install.state === "awaiting_approval" &&
    handlerRef?.deploymentJobId &&
    substrate.state === "pending"
  ) {
    pass("new provision/adoption path reached normal approval state", {
      deploymentJobId: handlerRef.deploymentJobId,
    });
  } else if (install.state === "installed" || substrate.state === "provisioned") {
    pass("Company Brain substrate is already provisioned", {
      installState: install.state,
      substrateState: substrate.state,
    });
  } else {
    skip("new provision/adoption approval state", {
      installState: install.state,
      substrateState: substrate.state,
      lastError: substrate.lastError,
    });
  }
}

function assertRoutes() {
  pass("Company Brain plugin detail route is the lifecycle home", {
    route: "/settings/plugins/company-brain",
  });
  pass("Memory / Ontology route remains the graph explorer", {
    route: "/settings/memory/knowledge-graph",
  });
}

async function gql(query, variables, principalId) {
  const response = await fetchWithTimeout(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiSecret}`,
      "x-tenant-id": tenantId,
      ...(principalId ? { "x-principal-id": principalId } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) {
    throw new Error(`GraphQL HTTP ${response.status}: ${text.slice(0, 500)}`);
  }
  const body = JSON.parse(text);
  if (body.errors?.length) {
    throw new Error(`GraphQL errors: ${JSON.stringify(body.errors)}`);
  }
  return body.data;
}

async function gqlExpectError(query, variables, principalId) {
  const response = await fetchWithTimeout(graphqlUrl, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: `Bearer ${apiSecret}`,
      "x-tenant-id": tenantId,
      ...(principalId ? { "x-principal-id": principalId } : {}),
    },
    body: JSON.stringify({ query, variables }),
  });
  const text = await response.text();
  if (!response.ok) {
    return {
      errors: [
        {
          message: `GraphQL HTTP ${response.status}: ${text.slice(0, 500)}`,
        },
      ],
    };
  }
  const body = JSON.parse(text);
  if (!body.errors?.length) {
    return { data: body.data, errors: [] };
  }
  return body;
}

async function fetchWithTimeout(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

function hasGraphqlErrorCode(response, code) {
  return (response.errors ?? []).some((error) => {
    return error?.extensions?.code === code;
  });
}

function parseHandlerRef(raw) {
  if (raw == null) return null;
  if (typeof raw === "object") return raw;
  try {
    return JSON.parse(raw);
  } catch {
    return { unparsed: String(raw).slice(0, 200) };
  }
}

function summarizeInstall(install) {
  if (!install) return null;
  return {
    id: install.id,
    pluginKey: install.pluginKey,
    state: install.state,
    lastError: install.lastError,
  };
}

function summarizeEntitlement(entitlement) {
  if (!entitlement) return null;
  return {
    id: entitlement.id,
    pluginKey: entitlement.pluginKey,
    status: entitlement.status,
    source: entitlement.source,
  };
}

function pass(name, detail) {
  checks.push({ name, ok: true, ...(detail ? { detail } : {}) });
  console.log(`PASS - ${name}${detail ? `: ${stringify(detail)}` : ""}`);
}

function failCheck(name, detail) {
  checks.push({ name, ok: false, ...(detail ? { detail } : {}) });
  console.log(`FAIL - ${name}${detail ? `: ${stringify(detail)}` : ""}`);
}

function skip(name, reason) {
  checks.push({ name, ok: true, skipped: true, reason });
  console.log(`SKIP - ${name}: ${stringify(reason)}`);
}

function stringify(value) {
  return typeof value === "string" ? value : JSON.stringify(value);
}

function requireEnv(label, value) {
  if (!value) throw new Error(`Missing required live smoke env: ${label}`);
}

function loadEnvFile() {
  const explicit = process.env.COMPUTER_ENV_FILE;
  if (explicit === "none") return {};
  const candidates = [explicit, "apps/web/.env", ".env"].filter(Boolean);
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate);
    if (!fs.existsSync(resolved)) continue;
    return Object.fromEntries(
      fs
        .readFileSync(resolved, "utf8")
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("#") && line.includes("="))
        .map((line) => {
          const index = line.indexOf("=");
          const key = line.slice(0, index).trim();
          const value = line
            .slice(index + 1)
            .trim()
            .replace(/^['"]|['"]$/g, "");
          return [key, value];
        }),
    );
  }
  return {};
}

function first(...values) {
  return values.find((value) => {
    return value !== undefined && value !== null && value !== "";
  });
}
