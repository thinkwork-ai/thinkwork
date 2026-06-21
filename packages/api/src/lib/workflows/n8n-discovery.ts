import { and, eq } from "drizzle-orm";
import {
  managedApplications,
  pluginInstalls,
  tenantCredentials,
  workflowEngineBindings,
  workflowTriggers,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";
import { readTenantCredentialSecret } from "../tenant-credentials/secret-store.js";

type WorkflowDb = any;

export type N8nDiscoveredWorkflow = {
  externalWorkflowId: string;
  name: string;
  active: boolean | null;
  triggerTypes: string[];
  lastModifiedAt: Date | null;
  lastExecutionAt: Date | null;
  warnings: string[];
};

export type N8nWorkflowDiscoveryResult = {
  installId: string;
  readinessState: "ready" | "blocked_not_ready" | "disabled";
  readinessReasons: unknown[];
  workflows: Array<
    N8nDiscoveredWorkflow & {
      connectedWorkflowId: string | null;
      connectedBindingId: string | null;
      readinessState: "ready" | "blocked_not_ready" | "disabled";
      readinessReasons: unknown[];
    }
  >;
};

export type ConnectN8nWorkflowInput = {
  tenantId: string;
  installId: string;
  externalWorkflowId: string;
  externalWorkflowName: string;
  active?: boolean | null;
  triggerTypes?: string[] | null;
  lastModifiedAt?: Date | string | null;
};

export type ConnectN8nWorkflowResult = {
  workflowId: string;
  bindingId: string;
  created: boolean;
};

type DiscoverN8nWorkflowsDeps = {
  fetch?: typeof fetch;
  readTenantCredentialSecret?: typeof readTenantCredentialSecret;
};

const N8N_WORKFLOW_CAPABILITIES = {
  start: false,
  monitor: true,
  cancel: false,
  retry: false,
  replay: false,
  evidence: true,
  bridge: true,
};

export async function discoverN8nWorkflows(
  database: WorkflowDb,
  input: { tenantId: string; installId: string },
  deps: DiscoverN8nWorkflowsDeps = {},
): Promise<N8nWorkflowDiscoveryResult> {
  const install = await loadN8nInstall(database, input);
  const app = await loadN8nManagedApplication(database, input.tenantId);
  const apiCredential = await loadN8nApiCredential(database, input.tenantId);
  const baseReadiness = n8nDiscoveryReadiness(install, app, {
    apiCredential,
    requireApiCredential: true,
  });
  const snapshotResult = await discoverN8nApiWorkflows({
    app,
    apiCredential,
    baseReadiness,
    deps,
  });
  const readiness = snapshotResult.readiness;
  const snapshot = snapshotResult.workflows;
  const connected = await loadConnectedN8nBindings(database, input);
  type ConnectedBinding = (typeof connected)[number];
  const discoveredById = new Map(
    snapshot.map((workflow) => [workflow.externalWorkflowId, workflow]),
  );

  for (const binding of connected) {
    if (!binding.external_workflow_id) continue;
    if (discoveredById.has(binding.external_workflow_id)) continue;
    discoveredById.set(binding.external_workflow_id, {
      externalWorkflowId: binding.external_workflow_id,
      name: binding.external_workflow_name ?? binding.external_workflow_id,
      active: null,
      triggerTypes: [],
      lastModifiedAt: null,
      lastExecutionAt: null,
      warnings: [
        "Connected in Thinkwork but not present in the latest n8n discovery snapshot.",
      ],
    });
  }

  return {
    installId: input.installId,
    readinessState: readiness.state,
    readinessReasons: readiness.reasons,
    workflows: [...discoveredById.values()]
      .sort((a, b) => a.name.localeCompare(b.name))
      .map((workflow) => {
        const binding = connected.find(
          (candidate: ConnectedBinding) =>
            candidate.external_workflow_id === workflow.externalWorkflowId,
        );
        const itemReadiness = n8nWorkflowReadiness(workflow, readiness);
        return {
          ...workflow,
          connectedWorkflowId: binding?.workflow_id ?? null,
          connectedBindingId: binding?.id ?? null,
          readinessState: itemReadiness.state,
          readinessReasons: itemReadiness.reasons,
        };
      }),
  };
}

async function discoverN8nApiWorkflows(args: {
  app: Awaited<ReturnType<typeof loadN8nManagedApplication>>;
  apiCredential: Awaited<ReturnType<typeof loadN8nApiCredential>>;
  baseReadiness: N8nWorkflowReadiness;
  deps: DiscoverN8nWorkflowsDeps;
}): Promise<{
  readiness: N8nWorkflowReadiness;
  workflows: N8nDiscoveredWorkflow[];
}> {
  const fallback = discoveredWorkflowsFromDesiredConfig(
    args.app?.desired_config,
  );
  if (args.baseReadiness.state !== "ready" || !args.apiCredential) {
    return { readiness: args.baseReadiness, workflows: fallback };
  }

  const desiredConfig = recordValue(args.app?.desired_config);
  const metadata = recordValue(args.apiCredential.metadata_json);
  const configuredBaseUrl =
    stringValue(metadata.n8nBaseUrl) ??
    stringValue(metadata.baseUrl) ??
    stringValue(metadata.publicUrl) ??
    stringValue(desiredConfig.publicUrl);
  if (!configuredBaseUrl) {
    return {
      readiness: {
        state: "blocked_not_ready",
        bindingStatus: "blocked_not_ready",
        reasons: [
          {
            code: "n8n_api_base_url_missing",
            message:
              "n8n API key is configured, but no n8n public URL is available.",
          },
        ],
      },
      workflows: fallback,
    };
  }

  try {
    const secret = await (
      args.deps.readTenantCredentialSecret ?? readTenantCredentialSecret
    )(args.apiCredential.secret_ref);
    const apiKey = stringValue(secret.apiKey);
    if (!apiKey) {
      return {
        readiness: {
          state: "blocked_not_ready",
          bindingStatus: "blocked_not_ready",
          reasons: [
            {
              code: "n8n_api_key_missing",
              message: "n8n API credential is missing the apiKey secret field.",
            },
          ],
        },
        workflows: fallback,
      };
    }
    return {
      readiness: args.baseReadiness,
      workflows: await fetchN8nPublicApiWorkflows({
        baseUrl: configuredBaseUrl,
        apiKey,
        fetchImpl: args.deps.fetch ?? fetch,
      }),
    };
  } catch (error) {
    return {
      readiness: {
        state: "blocked_not_ready",
        bindingStatus: "blocked_not_ready",
        reasons: [
          {
            code: "n8n_api_discovery_failed",
            message: `Could not discover n8n workflows: ${(error as Error).message}`,
          },
        ],
      },
      workflows: fallback,
    };
  }
}

async function fetchN8nPublicApiWorkflows(input: {
  baseUrl: string;
  apiKey: string;
  fetchImpl: typeof fetch;
}): Promise<N8nDiscoveredWorkflow[]> {
  const workflows: N8nDiscoveredWorkflow[] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 10; page += 1) {
    const endpoint = n8nWorkflowListUrl(input.baseUrl, cursor);
    const response = await input.fetchImpl(endpoint, {
      method: "GET",
      headers: {
        accept: "application/json",
        "X-N8N-API-KEY": input.apiKey,
      },
    });
    const text = await response.text();
    if (!response.ok) {
      throw new Error(
        `n8n API ${response.status}: ${text.slice(0, 300) || response.statusText}`,
      );
    }
    const payload = parseJsonRecord(text, endpoint);
    const data = Array.isArray(payload.data) ? payload.data : [];
    const records = await Promise.all(
      data.map((entry) => enrichN8nWorkflowRecord(input, entry)),
    );
    workflows.push(...records.flatMap(n8nWorkflowFromApiRecord));
    cursor = stringValue(payload.nextCursor);
    if (!cursor) break;
  }
  return workflows;
}

async function enrichN8nWorkflowRecord(
  input: {
    baseUrl: string;
    apiKey: string;
    fetchImpl: typeof fetch;
  },
  entry: unknown,
): Promise<unknown> {
  const parsed = n8nWorkflowFromApiRecord(entry)[0];
  if (!parsed || parsed.triggerTypes.length > 0) return entry;
  const workflowId = parsed.externalWorkflowId;
  const endpoint = n8nWorkflowDetailUrl(input.baseUrl, workflowId);
  const response = await input.fetchImpl(endpoint, {
    method: "GET",
    headers: {
      accept: "application/json",
      "X-N8N-API-KEY": input.apiKey,
    },
  });
  const text = await response.text();
  if (!response.ok) return entry;
  return {
    ...recordValue(entry),
    ...parseJsonRecord(text, endpoint),
  };
}

function n8nWorkflowListUrl(baseUrl: string, cursor: string | null): string {
  const root = n8nApiRootUrl(baseUrl);
  const endpoint = new URL("workflows", root);
  endpoint.searchParams.set("limit", "100");
  if (cursor) endpoint.searchParams.set("cursor", cursor);
  return endpoint.toString();
}

function n8nWorkflowDetailUrl(baseUrl: string, workflowId: string): string {
  const root = n8nApiRootUrl(baseUrl);
  return new URL(`workflows/${encodeURIComponent(workflowId)}`, root).toString();
}

function n8nApiRootUrl(value: string): URL {
  const url = new URL(value);
  const path = url.pathname.replace(/\/+$/, "");
  if (path.endsWith("/api/v1")) {
    url.pathname = `${path}/`;
  } else {
    url.pathname = `${path}/api/v1/`.replace(/\/+/g, "/");
  }
  url.search = "";
  url.hash = "";
  return url;
}

function n8nWorkflowFromApiRecord(entry: unknown): N8nDiscoveredWorkflow[] {
  const record = recordValue(entry);
  const id = stringValue(record.id);
  const name = stringValue(record.name) ?? id;
  if (!id || !name) return [];
  const nodes = Array.isArray(record.nodes) ? record.nodes : [];
  const explicitTriggerTypes = normalizeTriggerTypes(record.triggerTypes);
  return [
    {
      externalWorkflowId: id,
      name,
      active: booleanOrNull(record.active),
      triggerTypes: explicitTriggerTypes.length
        ? explicitTriggerTypes
        : inferTriggerTypes(nodes),
      lastModifiedAt: normalizeDate(record.updatedAt ?? record.lastModifiedAt),
      lastExecutionAt: normalizeDate(record.lastExecutionAt),
      warnings: [],
    },
  ];
}

function inferTriggerTypes(nodes: unknown[]): string[] {
  const values = new Set<string>();
  for (const node of nodes) {
    const type = stringValue(recordValue(node).type)?.toLowerCase() ?? "";
    if (!type) continue;
    if (type.includes("webhook")) values.add("webhook");
    else if (type.includes("schedule") || type.includes("cron"))
      values.add("schedule");
    else if (type.includes("manualtrigger")) values.add("manual");
    else if (type.includes("formtrigger")) values.add("form");
    else if (type.includes("trigger")) values.add("trigger");
  }
  return [...values];
}

function parseJsonRecord(text: string, endpoint: string): Record<string, unknown> {
  try {
    return recordValue(JSON.parse(text));
  } catch (error) {
    throw new Error(
      `n8n API returned invalid JSON from ${endpoint}: ${(error as Error).message}`,
    );
  }
}

export async function connectN8nWorkflow(
  database: WorkflowDb,
  input: ConnectN8nWorkflowInput,
): Promise<ConnectN8nWorkflowResult> {
  const install = await loadN8nInstall(database, {
    tenantId: input.tenantId,
    installId: input.installId,
  });
  const app = await loadN8nManagedApplication(database, input.tenantId);
  const readiness = n8nWorkflowReadiness(
    {
      externalWorkflowId: input.externalWorkflowId,
      name: input.externalWorkflowName,
      active: input.active ?? null,
      triggerTypes: normalizeTriggerTypes(input.triggerTypes),
      lastModifiedAt: normalizeDate(input.lastModifiedAt),
      lastExecutionAt: null,
      warnings: [],
    },
    n8nDiscoveryReadiness(install, app),
  );

  const existing = await dbSelect(database)
    .select({
      id: workflowEngineBindings.id,
      workflow_id: workflowEngineBindings.workflow_id,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, input.tenantId),
        eq(workflowEngineBindings.binding_type, "n8n_bridge"),
        eq(
          workflowEngineBindings.external_workflow_id,
          input.externalWorkflowId,
        ),
      ),
    )
    .limit(1);
  if (existing[0]) {
    await refreshN8nWorkflowProjection(database, {
      ...input,
      workflowId: existing[0].workflow_id,
      bindingId: existing[0].id,
      managedApplicationId: app?.id ?? null,
      readiness,
    });
    return {
      workflowId: existing[0].workflow_id,
      bindingId: existing[0].id,
      created: false,
    };
  }

  const workflowRows = await dbInsert(database)
    .insert(workflows)
    .values({
      tenant_id: input.tenantId,
      name: input.externalWorkflowName,
      slug: n8nWorkflowSlug(input.externalWorkflowId),
      description: null,
      lifecycle_status: "active",
      visibility: "tenant_shared",
      primary_trigger_family: "n8n",
      capability_flags: N8N_WORKFLOW_CAPABILITIES,
      readiness_state: readiness.state,
      readiness_reasons: readiness.reasons,
    })
    .returning({ id: workflows.id });
  const workflowId = workflowRows[0].id;

  const versionRows = await dbInsert(database)
    .insert(workflowVersions)
    .values({
      tenant_id: input.tenantId,
      workflow_id: workflowId,
      version_number: 1,
      version_status: "active",
      source_kind: "n8n_bridge",
      source_metadata: n8nSourceMetadata(input),
      definition_snapshot: n8nDefinitionSnapshot(input),
      capability_snapshot: N8N_WORKFLOW_CAPABILITIES,
      published_at: normalizeDate(input.lastModifiedAt) ?? new Date(),
    })
    .returning({ id: workflowVersions.id });
  const versionId = versionRows[0].id;

  await dbUpdate(database)
    .update(workflows)
    .set({
      current_version_id: versionId,
      current_version_number: 1,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, workflowId));

  const bindingRows = await dbInsert(database)
    .insert(workflowEngineBindings)
    .values({
      tenant_id: input.tenantId,
      workflow_id: workflowId,
      workflow_version_id: versionId,
      binding_type: "n8n_bridge",
      binding_status: readiness.bindingStatus,
      plugin_install_id: input.installId,
      managed_application_id: app?.id ?? null,
      external_workflow_id: input.externalWorkflowId,
      external_workflow_name: input.externalWorkflowName,
      connection_ref: {
        installId: input.installId,
        source: "n8n_plugin",
        publicUrl: stringValue(recordValue(app?.desired_config).publicUrl),
      },
      capability_flags: N8N_WORKFLOW_CAPABILITIES,
      readiness_state: readiness.state,
      readiness_reasons: readiness.reasons,
    })
    .returning({ id: workflowEngineBindings.id });
  const bindingId = bindingRows[0].id;

  await ensureN8nWorkflowTrigger(database, {
    ...input,
    workflowId,
    workflowVersionId: versionId,
    readiness,
  });

  return { workflowId, bindingId, created: true };
}

function discoveredWorkflowsFromDesiredConfig(
  desiredConfig: unknown,
): N8nDiscoveredWorkflow[] {
  const config = recordValue(desiredConfig);
  const raw = Array.isArray(config.workflowDiscoverySnapshot)
    ? config.workflowDiscoverySnapshot
    : Array.isArray(config.discoveredWorkflows)
      ? config.discoveredWorkflows
      : [];
  return raw.flatMap((entry) => {
    const record = recordValue(entry);
    const id = stringValue(record.id) ?? stringValue(record.workflowId);
    const name = stringValue(record.name) ?? id;
    if (!id || !name) return [];
    return [
      {
        externalWorkflowId: id,
        name,
        active: booleanOrNull(record.active),
        triggerTypes: normalizeTriggerTypes(record.triggerTypes),
        lastModifiedAt: normalizeDate(
          record.lastModifiedAt ?? record.updatedAt,
        ),
        lastExecutionAt: normalizeDate(record.lastExecutionAt),
        warnings: stringArray(record.warnings),
      },
    ];
  });
}

async function loadConnectedN8nBindings(
  database: WorkflowDb,
  input: { tenantId: string; installId: string },
) {
  return dbSelect(database)
    .select({
      id: workflowEngineBindings.id,
      workflow_id: workflowEngineBindings.workflow_id,
      external_workflow_id: workflowEngineBindings.external_workflow_id,
      external_workflow_name: workflowEngineBindings.external_workflow_name,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, input.tenantId),
        eq(workflowEngineBindings.plugin_install_id, input.installId),
        eq(workflowEngineBindings.binding_type, "n8n_bridge"),
      ),
    );
}

async function refreshN8nWorkflowProjection(
  database: WorkflowDb,
  input: ConnectN8nWorkflowInput & {
    workflowId: string;
    bindingId: string;
    managedApplicationId: string | null;
    readiness: N8nWorkflowReadiness;
  },
): Promise<void> {
  await dbUpdate(database)
    .update(workflows)
    .set({
      name: input.externalWorkflowName,
      lifecycle_status: "active",
      primary_trigger_family: "n8n",
      capability_flags: N8N_WORKFLOW_CAPABILITIES,
      readiness_state: input.readiness.state,
      readiness_reasons: input.readiness.reasons,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, input.workflowId));
  await dbUpdate(database)
    .update(workflowEngineBindings)
    .set({
      external_workflow_name: input.externalWorkflowName,
      managed_application_id: input.managedApplicationId,
      binding_status: input.readiness.bindingStatus,
      capability_flags: N8N_WORKFLOW_CAPABILITIES,
      readiness_state: input.readiness.state,
      readiness_reasons: input.readiness.reasons,
      updated_at: new Date(),
    })
    .where(eq(workflowEngineBindings.id, input.bindingId));
  await ensureN8nWorkflowTrigger(database, {
    ...input,
    workflowVersionId: null,
    readiness: input.readiness,
  });
}

async function ensureN8nWorkflowTrigger(
  database: WorkflowDb,
  input: ConnectN8nWorkflowInput & {
    workflowId: string;
    workflowVersionId: string | null;
    readiness: N8nWorkflowReadiness;
  },
): Promise<void> {
  const existing = await dbSelect(database)
    .select({ id: workflowTriggers.id })
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.workflow_id, input.workflowId),
        eq(workflowTriggers.trigger_family, "n8n"),
      ),
    )
    .limit(1);
  const values = {
    workflow_version_id: input.workflowVersionId,
    source_system: "n8n",
    enabled: input.readiness.state === "ready",
    idempotency_required: true,
    trigger_config: {
      externalWorkflowId: input.externalWorkflowId,
      triggerTypes: normalizeTriggerTypes(input.triggerTypes),
    },
    actor_contract: { actorType: "connected_app", source: "n8n" },
    readiness_state: input.readiness.state,
    readiness_reasons: input.readiness.reasons,
    updated_at: new Date(),
  };
  if (existing[0]) {
    await dbUpdate(database)
      .update(workflowTriggers)
      .set(values)
      .where(eq(workflowTriggers.id, existing[0].id));
    return;
  }
  await dbInsert(database)
    .insert(workflowTriggers)
    .values({
      tenant_id: input.tenantId,
      workflow_id: input.workflowId,
      trigger_family: "n8n",
      ...values,
    });
}

async function loadN8nInstall(
  database: WorkflowDb,
  input: { tenantId: string; installId: string },
) {
  const [install] = await dbSelect(database)
    .select({
      id: pluginInstalls.id,
      state: pluginInstalls.state,
    })
    .from(pluginInstalls)
    .where(
      and(
        eq(pluginInstalls.tenant_id, input.tenantId),
        eq(pluginInstalls.id, input.installId),
        eq(pluginInstalls.plugin_key, "n8n"),
      ),
    )
    .limit(1);
  if (!install) {
    throw new Error("n8n plugin install was not found");
  }
  return install;
}

async function loadN8nManagedApplication(
  database: WorkflowDb,
  tenantId: string,
) {
  const [app] = await dbSelect(database)
    .select()
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.key, "n8n"),
      ),
    )
    .limit(1);
  return app ?? null;
}

async function loadN8nApiCredential(database: WorkflowDb, tenantId: string) {
  const [credential] = await dbSelect(database)
    .select({
      id: tenantCredentials.id,
      secret_ref: tenantCredentials.secret_ref,
      metadata_json: tenantCredentials.metadata_json,
    })
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, tenantId),
        eq(tenantCredentials.slug, "n8n-api"),
        eq(tenantCredentials.status, "active"),
      ),
    )
    .limit(1);
  return credential ?? null;
}

type N8nWorkflowReadiness = {
  state: "ready" | "blocked_not_ready" | "disabled";
  bindingStatus: "ready" | "blocked_not_ready" | "disabled";
  reasons: unknown[];
};

function n8nDiscoveryReadiness(
  install: { state: string },
  app: {
    desired_status?: string | null;
    current_status?: string | null;
    desired_config?: unknown;
  } | null,
  options: {
    apiCredential?: { id: string } | null;
    requireApiCredential?: boolean;
  } = {},
): N8nWorkflowReadiness {
  if (install.state === "uninstalling" || install.state === "failed") {
    return {
      state: "disabled",
      bindingStatus: "disabled",
      reasons: [
        { code: "plugin_unavailable", message: "n8n plugin is not installed." },
      ],
    };
  }
  if (!app) {
    return {
      state: "blocked_not_ready",
      bindingStatus: "blocked_not_ready",
      reasons: [
        {
          code: "managed_app_missing",
          message: "n8n managed application is not provisioned.",
        },
      ],
    };
  }
  if (app.desired_status === "disabled") {
    return {
      state: "disabled",
      bindingStatus: "disabled",
      reasons: [
        { code: "runtime_disabled", message: "n8n runtime is parked." },
      ],
    };
  }
  const desiredConfig = recordValue(app.desired_config);
  if (!stringValue(desiredConfig.serviceCredentialSecretArn)) {
    return {
      state: "blocked_not_ready",
      bindingStatus: "blocked_not_ready",
      reasons: [
        {
          code: "service_credential_missing",
          message: "n8n service credential is not configured.",
        },
      ],
    };
  }
  if (options.requireApiCredential && !options.apiCredential) {
    return {
      state: "blocked_not_ready",
      bindingStatus: "blocked_not_ready",
      reasons: [
        {
          code: "n8n_api_key_missing",
          message:
            "n8n API key is not configured. Add one in the n8n plugin Settings tab to discover workflows.",
        },
      ],
    };
  }
  return { state: "ready", bindingStatus: "ready", reasons: [] };
}

function n8nWorkflowReadiness(
  workflow: N8nDiscoveredWorkflow,
  base: N8nWorkflowReadiness,
): N8nWorkflowReadiness {
  if (base.state !== "ready") return base;
  if (workflow.active === false) {
    return {
      state: "blocked_not_ready",
      bindingStatus: "blocked_not_ready",
      reasons: [
        { code: "n8n_workflow_inactive", message: "n8n workflow is inactive." },
      ],
    };
  }
  return base;
}

export function n8nWorkflowSlug(externalWorkflowId: string): string {
  const normalized = externalWorkflowId
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 64);
  return `n8n-${normalized || "workflow"}`;
}

function n8nSourceMetadata(input: ConnectN8nWorkflowInput) {
  return {
    source: "n8n_plugin",
    externalWorkflowId: input.externalWorkflowId,
    externalWorkflowName: input.externalWorkflowName,
    active: input.active ?? null,
    triggerTypes: normalizeTriggerTypes(input.triggerTypes),
    lastModifiedAt: normalizeDate(input.lastModifiedAt)?.toISOString() ?? null,
  };
}

function n8nDefinitionSnapshot(input: ConnectN8nWorkflowInput) {
  return {
    externalWorkflowId: input.externalWorkflowId,
    name: input.externalWorkflowName,
    triggerTypes: normalizeTriggerTypes(input.triggerTypes),
    importMode: "bridge_reference",
  };
}

function normalizeTriggerTypes(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return [
    ...new Set(
      value
        .filter((entry): entry is string => typeof entry === "string")
        .map((entry) => entry.trim())
        .filter(Boolean),
    ),
  ];
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
}

function stringArray(value: unknown): string[] {
  return normalizeTriggerTypes(value);
}

function booleanOrNull(value: unknown): boolean | null {
  return typeof value === "boolean" ? value : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function recordValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function dbSelect(database: WorkflowDb): any {
  return database as any;
}

function dbInsert(database: WorkflowDb): any {
  return database as any;
}

function dbUpdate(database: WorkflowDb): any {
  return database as any;
}
