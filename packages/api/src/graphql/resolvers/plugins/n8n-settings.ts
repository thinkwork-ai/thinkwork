import { randomUUID } from "node:crypto";
import { and, desc, eq } from "drizzle-orm";
import { GraphQLError } from "graphql";
import {
  managedApplicationDeploymentJobs,
  managedApplications,
  tenantCredentials,
} from "@thinkwork/database-pg/schema";
import {
  normalizeN8nPackageConfig,
  type NormalizedN8nPackageConfig,
} from "@thinkwork/plugin-n8n/package-config";
import { N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH } from "@thinkwork/plugin-n8n/manifest";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb } from "../../utils.js";
import {
  createDefaultPluginEngineDeps,
  type PluginEngineDeps,
} from "../../../lib/plugins/engine.js";
import {
  startManagedApplicationPlanJob,
  type ManagedApplicationDeploymentJobRow,
} from "../../../lib/deployments/start-plan-job.js";
import {
  putTenantCredentialSecret,
  rotateTenantCredentialSecret,
  tenantCredentialSecretName,
} from "../../../lib/tenant-credentials/secret-store.js";
import {
  toDeploymentPayload,
  type DeploymentOperation,
} from "../deployments/shared.js";
import { requirePluginTenantAdmin } from "./shared.js";
import type { PluginInstallRow } from "../../../lib/plugins/store.js";
import { loadN8nAgentStepRunTelemetry } from "../n8n-agent-step-runs/telemetry.js";

type DbLike = typeof defaultDb;

type ManagedApplicationRow = typeof managedApplications.$inferSelect;
type TenantCredentialRow = typeof tenantCredentials.$inferSelect;

export interface N8nPluginSettingsDeps {
  db?: DbLike;
  pluginDeps?: PluginEngineDeps;
  startPlanJob?: typeof startManagedApplicationPlanJob;
  putTenantCredentialSecret?: typeof putTenantCredentialSecret;
  rotateTenantCredentialSecret?: typeof rotateTenantCredentialSecret;
}

const N8N_API_CREDENTIAL_SLUG = "n8n-api";

export async function n8nPluginSettings(
  _parent: unknown,
  args: { installId: string },
  ctx: GraphQLContext,
  deps: N8nPluginSettingsDeps = {},
) {
  const { tenantId } = await requirePluginTenantAdmin(ctx);
  const pluginDeps = deps.pluginDeps ?? createDefaultPluginEngineDeps();
  const install = await requireN8nInstall({
    tenantId,
    installId: args.installId,
    pluginDeps,
  });
  const db = deps.db ?? defaultDb;
  const app = await findN8nManagedApplication(tenantId, db);
  const latestJob = await findLatestN8nDeploymentJob(tenantId, db);
  const recentAgentStepRuns = await loadN8nAgentStepRunTelemetry({
    tenantId,
    pluginInstallId: install.id,
    managedApplicationId: app?.id ?? null,
    limit: 5,
    db,
  });
  const n8nApiCredential = await findN8nApiCredential(tenantId, db);
  return settingsPayload({
    install,
    app,
    latestJob,
    recentAgentStepRuns,
    n8nApiCredential,
  });
}

export async function updateN8nPluginPackageSettings(
  _parent: unknown,
  args: {
    input: {
      installId: string;
      customPackageSpecs: string[];
      expectedCurrentDigest?: string | null;
      idempotencyKey: string;
    };
  },
  ctx: GraphQLContext,
  deps: N8nPluginSettingsDeps = {},
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const idempotencyKey = args.input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const pluginDeps = deps.pluginDeps ?? createDefaultPluginEngineDeps();
  const install = await requireN8nInstall({
    tenantId,
    installId: args.input.installId,
    pluginDeps,
  });
  const db = deps.db ?? defaultDb;
  const app = await findN8nManagedApplication(tenantId, db);
  if (!app) {
    throw new GraphQLError("n8n managed application is not provisioned yet", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }
  if (!app.selected_release_version || !app.selected_manifest_digest) {
    throw new GraphQLError(
      "n8n managed application is missing release metadata for an upgrade plan",
      { extensions: { code: "FAILED_PRECONDITION" } },
    );
  }

  const desiredConfig = recordValue(app.desired_config);
  const currentConfig = normalizeN8nPackageConfig(desiredConfig);
  const expectedDigest = args.input.expectedCurrentDigest?.trim();
  if (
    expectedDigest &&
    expectedDigest.toLowerCase() !== currentConfig.digest.toLowerCase()
  ) {
    throw new GraphQLError(
      `n8n package settings changed; expected ${expectedDigest} but current digest is ${currentConfig.digest}`,
      { extensions: { code: "CONFLICT" } },
    );
  }

  const nextConfig = normalizeN8nPackageConfig(args.input.customPackageSpecs);
  const desiredConfigChanged = nextConfig.digest !== currentConfig.digest;
  const nextDesiredConfig = nextDesiredConfigForPackages({
    desiredConfig,
    packageConfig: nextConfig,
    changed: desiredConfigChanged,
  });
  const startPlan =
    deps.startPlanJob ??
    ((input, planDeps) => startManagedApplicationPlanJob(input, planDeps));
  const started = await startPlan(
    {
      tenantId,
      requestedByUserId: callerUserId,
      appKey: "n8n",
      operation: "UPGRADE" satisfies DeploymentOperation,
      idempotencyKey,
      releaseVersion: app.selected_release_version,
      manifestDigest: app.selected_manifest_digest,
      desiredConfigVersion: "v1",
      desiredConfig: nextDesiredConfig,
    },
    {},
  );
  const plannedDesiredConfig =
    plannedDesiredConfigFromJob(started.job) ?? nextDesiredConfig;
  const plannedConfig = normalizeN8nPackageConfig(plannedDesiredConfig);
  if (plannedConfig.digest !== nextConfig.digest) {
    throw new GraphQLError(
      "idempotencyKey was already used for different n8n package settings",
      { extensions: { code: "CONFLICT" } },
    );
  }
  const updatedApp: ManagedApplicationRow = {
    ...app,
    desired_config: plannedDesiredConfig,
    desired_status: "enabled",
    last_job_id: started.job.id,
    updated_at: new Date(),
  };

  return {
    settings: settingsPayload({
      install,
      app: updatedApp,
      latestJob: started.job,
      recentAgentStepRuns: [],
    }),
    deploymentJob: toDeploymentPayload(started.job, started.events),
  };
}

export async function updateN8nPluginApiCredential(
  _parent: unknown,
  args: {
    input: {
      installId: string;
      apiKey: string;
      baseUrl?: string | null;
      idempotencyKey: string;
    };
  },
  ctx: GraphQLContext,
  deps: N8nPluginSettingsDeps = {},
) {
  const { tenantId, callerUserId } = await requirePluginTenantAdmin(ctx);
  const idempotencyKey = args.input.idempotencyKey.trim();
  if (!idempotencyKey) {
    throw new GraphQLError("idempotencyKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const apiKey = args.input.apiKey.trim();
  if (!apiKey) {
    throw new GraphQLError("apiKey is required", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }

  const pluginDeps = deps.pluginDeps ?? createDefaultPluginEngineDeps();
  const install = await requireN8nInstall({
    tenantId,
    installId: args.input.installId,
    pluginDeps,
  });
  const db = deps.db ?? defaultDb;
  const app = await findN8nManagedApplication(tenantId, db);
  if (!app) {
    throw new GraphQLError("n8n managed application is not provisioned yet", {
      extensions: { code: "FAILED_PRECONDITION" },
    });
  }

  const desiredConfig = recordValue(app.desired_config);
  const baseUrl = normalizeN8nBaseUrl(
    args.input.baseUrl ?? stringValue(desiredConfig.publicUrl),
  );
  const metadata = { n8nBaseUrl: baseUrl };
  const existing = await findN8nApiCredential(tenantId, db);
  const savedCredential = existing
    ? await updateExistingN8nApiCredential({
        credential: existing,
        apiKey,
        metadata,
        db,
        rotateSecret: deps.rotateTenantCredentialSecret,
      })
    : await createN8nApiCredential({
        tenantId,
        callerUserId,
        apiKey,
        metadata,
        db,
        putSecret: deps.putTenantCredentialSecret,
      });

  return {
    settings: settingsPayload({
      install,
      app,
      latestJob: await findLatestN8nDeploymentJob(tenantId, db),
      recentAgentStepRuns: [],
      n8nApiCredential: savedCredential,
    }),
  };
}

async function requireN8nInstall(args: {
  tenantId: string;
  installId: string;
  pluginDeps: PluginEngineDeps;
}): Promise<PluginInstallRow> {
  const install = await args.pluginDeps.store.getInstallById(
    args.tenantId,
    args.installId,
  );
  if (!install || install.plugin_key !== "n8n") {
    throw new GraphQLError("n8n plugin install was not found", {
      extensions: { code: "NOT_FOUND" },
    });
  }
  return install;
}

async function findN8nManagedApplication(
  tenantId: string,
  db: DbLike,
): Promise<ManagedApplicationRow | null> {
  const [row] = await db
    .select()
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.key, "n8n"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function findLatestN8nDeploymentJob(
  tenantId: string,
  db: DbLike,
): Promise<ManagedApplicationDeploymentJobRow | null> {
  const [row] = await db
    .select()
    .from(managedApplicationDeploymentJobs)
    .where(
      and(
        eq(managedApplicationDeploymentJobs.tenant_id, tenantId),
        eq(managedApplicationDeploymentJobs.app_key, "n8n"),
      ),
    )
    .orderBy(desc(managedApplicationDeploymentJobs.updated_at))
    .limit(1);
  return row ?? null;
}

async function findN8nApiCredential(
  tenantId: string,
  db: DbLike,
): Promise<TenantCredentialRow | null> {
  const [row] = await db
    .select()
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, tenantId),
        eq(tenantCredentials.slug, N8N_API_CREDENTIAL_SLUG),
        eq(tenantCredentials.status, "active"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function createN8nApiCredential(args: {
  tenantId: string;
  callerUserId: string | null;
  apiKey: string;
  metadata: Record<string, unknown>;
  db: DbLike;
  putSecret?: typeof putTenantCredentialSecret;
}): Promise<TenantCredentialRow> {
  const credentialId = randomUUID();
  const secretName = tenantCredentialSecretName({
    tenantId: args.tenantId,
    credentialId,
  });
  const secretRef = await (args.putSecret ?? putTenantCredentialSecret)({
    secretName,
    payload: { apiKey: args.apiKey },
  });
  const [row] = await args.db
    .insert(tenantCredentials)
    .values({
      id: credentialId,
      tenant_id: args.tenantId,
      display_name: "n8n API key",
      slug: N8N_API_CREDENTIAL_SLUG,
      kind: "api_key",
      status: "active",
      secret_ref: secretRef,
      schema_json: {},
      metadata_json: args.metadata,
      created_by_user_id: args.callerUserId,
    })
    .returning();
  return row;
}

async function updateExistingN8nApiCredential(args: {
  credential: TenantCredentialRow;
  apiKey: string;
  metadata: Record<string, unknown>;
  db: DbLike;
  rotateSecret?: typeof rotateTenantCredentialSecret;
}): Promise<TenantCredentialRow> {
  await (args.rotateSecret ?? rotateTenantCredentialSecret)({
    secretRef: args.credential.secret_ref,
    payload: { apiKey: args.apiKey },
  });
  const [row] = await args.db
    .update(tenantCredentials)
    .set({
      display_name: "n8n API key",
      kind: "api_key",
      status: "active",
      metadata_json: args.metadata,
      updated_at: new Date(),
      last_validated_at: null,
    })
    .where(eq(tenantCredentials.id, args.credential.id))
    .returning();
  return row;
}

function settingsPayload(args: {
  install: PluginInstallRow;
  app: ManagedApplicationRow | null;
  latestJob: ManagedApplicationDeploymentJobRow | null;
  recentAgentStepRuns?: unknown[];
  n8nApiCredential?: TenantCredentialRow | null;
}) {
  const desiredConfig = recordValue(args.app?.desired_config);
  const n8nApiCredentialMetadata = recordValue(
    args.n8nApiCredential?.metadata_json,
  );
  const packageConfig = normalizeN8nPackageConfig(desiredConfig);
  return {
    pluginInstallId: args.install.id,
    installState: args.install.state,
    managedApplicationId: args.app?.id ?? null,
    desiredStatus: args.app?.desired_status ?? null,
    currentStatus: args.app?.current_status ?? null,
    desiredConfig: publicDesiredConfig(desiredConfig),
    agentStepBridgeEndpointPath: N8N_AGENT_STEP_BRIDGE_ENDPOINT_PATH,
    agentStepBridgeCredentialConfigured: Boolean(
      stringValue(desiredConfig.agentStepBridgeCredentialSecretArn),
    ),
    n8nApiCredentialConfigured: Boolean(args.n8nApiCredential),
    n8nApiCredentialBaseUrl:
      stringValue(n8nApiCredentialMetadata.n8nBaseUrl) ??
      stringValue(n8nApiCredentialMetadata.baseUrl) ??
      stringValue(n8nApiCredentialMetadata.publicUrl) ??
      stringValue(desiredConfig.publicUrl),
    currentPackageConfig: packageConfigPayload(packageConfig),
    packageImageUri: stringValue(desiredConfig.packageImageUri),
    packageImageConfigDigest: stringValue(
      desiredConfig.packageImageConfigDigest,
    ),
    lastJobId: args.latestJob?.id ?? args.app?.last_job_id ?? null,
    lastJobStatus: args.latestJob?.status ?? null,
    lastJobOperation: args.latestJob?.operation ?? null,
    lastJobError: args.latestJob?.error_message ?? null,
    lastEvidenceBucket: args.latestJob?.evidence_bucket ?? null,
    lastEvidencePrefix: args.latestJob?.evidence_prefix ?? null,
    recentAgentStepRuns: args.recentAgentStepRuns ?? [],
  };
}

function packageConfigPayload(config: NormalizedN8nPackageConfig) {
  return {
    schemaVersion: config.schemaVersion,
    packages: config.packages,
    packageNames: config.packageNames,
    packageSpecs: config.packageSpecs,
    allowExternal: config.allowExternal,
    digest: config.digest,
  };
}

function nextDesiredConfigForPackages(args: {
  desiredConfig: Record<string, unknown>;
  packageConfig: NormalizedN8nPackageConfig;
  changed: boolean;
}): Record<string, unknown> {
  const next: Record<string, unknown> = {
    ...args.desiredConfig,
    customPackageSpecs: args.packageConfig.packageSpecs,
    packageConfigDigest: args.packageConfig.digest,
  };
  if (args.changed) {
    delete next.packageImageUri;
    delete next.packageImageConfigDigest;
  }
  return next;
}

function publicDesiredConfig(
  desiredConfig: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(desiredConfig).filter(([key]) => {
      const lower = key.toLowerCase();
      return !lower.includes("secret") && !lower.includes("credential");
    }),
  );
}

function recordValue(value: unknown): Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function plannedDesiredConfigFromJob(
  job: ManagedApplicationDeploymentJobRow,
): Record<string, unknown> | null {
  const summary = recordValue(job.plan_summary);
  const desiredConfig = summary.desiredConfig;
  return typeof desiredConfig === "object" &&
    desiredConfig !== null &&
    !Array.isArray(desiredConfig)
    ? (desiredConfig as Record<string, unknown>)
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}

function normalizeN8nBaseUrl(value: unknown): string {
  const raw = stringValue(value);
  if (!raw) {
    throw new GraphQLError(
      "n8n public URL is required before saving an API key",
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch (error) {
    throw new GraphQLError(
      `n8n public URL must be a valid URL: ${(error as Error).message}`,
      { extensions: { code: "BAD_USER_INPUT" } },
    );
  }
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new GraphQLError("n8n public URL must use https", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  parsed.search = "";
  parsed.hash = "";
  return parsed.toString().replace(/\/+$/, "");
}
