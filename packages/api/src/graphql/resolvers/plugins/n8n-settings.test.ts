import { beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";
import { normalizeN8nPackageConfig } from "@thinkwork/plugin-n8n/package-config";

const {
  mockRequireTenantAdmin,
  mockResolveCallerTenantId,
  mockResolveCallerUserId,
  selectQueue,
} = vi.hoisted(() => ({
  mockRequireTenantAdmin: vi.fn(),
  mockResolveCallerTenantId: vi.fn(),
  mockResolveCallerUserId: vi.fn(),
  selectQueue: [] as unknown[][],
}));

vi.mock("../../utils.js", () => ({
  db: {},
  snakeToCamel: (row: Record<string, unknown>) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/_([a-z])/g, (_, char: string) => char.toUpperCase()),
        value,
      ]),
    ),
}));

vi.mock("../core/authz.js", () => ({
  requireTenantAdmin: mockRequireTenantAdmin,
}));

vi.mock("../core/resolve-auth-user.js", () => ({
  resolveCallerTenantId: mockResolveCallerTenantId,
  resolveCallerUserId: mockResolveCallerUserId,
}));

import {
  createInMemoryPluginEngineStore,
  type InMemoryPluginEngineStore,
} from "../../../lib/plugins/testing.js";
import {
  n8nPluginSettings,
  updateN8nPluginPackageSettings,
} from "./n8n-settings.js";
import type { PluginEngineDeps } from "../../../lib/plugins/engine.js";

const CTX = { auth: { tenantId: null } } as never;
const TENANT_ID = "tenant-1";
const USER_ID = "user-1";

let store: InMemoryPluginEngineStore;
let installId: string;

beforeEach(() => {
  vi.clearAllMocks();
  selectQueue.length = 0;
  mockResolveCallerTenantId.mockResolvedValue(TENANT_ID);
  mockResolveCallerUserId.mockResolvedValue(USER_ID);
  mockRequireTenantAdmin.mockResolvedValue(undefined);
  store = createInMemoryPluginEngineStore();
  installId = store.seedInstall({
    tenant_id: TENANT_ID,
    plugin_key: "n8n",
    state: "installed",
  }).id;
});

describe("n8nPluginSettings", () => {
  it("returns normalized package config and redacts secret refs", async () => {
    const current = normalizeN8nPackageConfig(["lodash@4.17.21"]);
    const result = (await n8nPluginSettings(null, { installId }, CTX, {
      db: fakeDb({
        app: appRow({
          desired_config: {
            customPackageSpecs: ["lodash@4.17.21"],
            packageConfigDigest: current.digest,
            publicUrl: "https://n8n.example.test",
            serviceCredentialSecretArn: "arn:aws:secretsmanager:secret",
            agentStepBridgeCredentialSecretArn:
              "arn:aws:secretsmanager:bridge-secret",
          },
        }),
        latestJob: jobRow({ id: "job-last", status: "succeeded" }),
      }),
      pluginDeps: pluginDeps(),
    })) as Record<string, any>;

    expect(mockRequireTenantAdmin).toHaveBeenCalledWith(CTX, TENANT_ID);
    expect(result.currentPackageConfig).toMatchObject({
      packageSpecs: ["lodash@4.17.21"],
      digest: current.digest,
    });
    expect(result.desiredConfig.publicUrl).toBe("https://n8n.example.test");
    expect(result.desiredConfig.serviceCredentialSecretArn).toBeUndefined();
    expect(
      result.desiredConfig.agentStepBridgeCredentialSecretArn,
    ).toBeUndefined();
    expect(result.agentStepBridgeEndpointPath).toBe(
      "/api/integrations/n8n/agent-steps",
    );
    expect(result.agentStepBridgeCredentialConfigured).toBe(true);
    expect(result.lastJobStatus).toBe("succeeded");
  });

  it("returns recent redacted bridge telemetry for the n8n settings surface", async () => {
    const result = (await n8nPluginSettings(null, { installId }, CTX, {
      db: fakeDb({
        app: appRow({ id: "app-n8n" }),
        recentRuns: [
          runRow({
            plugin_install_id: installId,
            managed_application_id: "app-n8n",
            status: "resume_failed",
            resume_status: "failed",
            output_payload: { secret: "raw output should not leak" },
            error_payload: { message: "n8n callback returned 410 Gone" },
            resume_url_host: "n8n.example.test",
            resume_url_path: "/webhook-waiting/leaky-token",
          }),
        ],
      }),
      pluginDeps: pluginDeps(),
    })) as Record<string, any>;

    expect(result.recentAgentStepRuns).toHaveLength(1);
    expect(result.recentAgentStepRuns[0]).toMatchObject({
      status: "resume_failed",
      resumeStatus: "failed",
      outputPreview: null,
      errorMessage: "n8n callback returned 410 Gone",
      pluginInstallId: installId,
      managedApplicationId: "app-n8n",
    });
    expect(JSON.stringify(result.recentAgentStepRuns[0])).not.toContain(
      "raw output should not leak",
    );
    expect(result.recentAgentStepRuns[0]).not.toHaveProperty("tenantId");
    expect(result.recentAgentStepRuns[0]).not.toHaveProperty("idempotencyKey");
    expect(result.recentAgentStepRuns[0]).not.toHaveProperty("resumeUrlHost");
    expect(result.recentAgentStepRuns[0]).not.toHaveProperty("resumeUrlPath");
    expect(result.recentAgentStepRuns[0]).not.toHaveProperty("outputPayload");
  });

  it("reports a missing bridge credential without leaking secret fields", async () => {
    const result = (await n8nPluginSettings(null, { installId }, CTX, {
      db: fakeDb({
        app: appRow({
          desired_config: {
            publicUrl: "https://n8n.example.test",
          },
        }),
      }),
      pluginDeps: pluginDeps(),
    })) as Record<string, any>;

    expect(result.desiredConfig).toEqual({
      publicUrl: "https://n8n.example.test",
    });
    expect(result.agentStepBridgeCredentialConfigured).toBe(false);
  });
});

describe("updateN8nPluginPackageSettings", () => {
  it("normalizes package specs and creates an n8n UPGRADE plan job", async () => {
    const current = normalizeN8nPackageConfig(["lodash@4.17.21"]);
    const next = normalizeN8nPackageConfig([
      "@aws-sdk/client-s3@3.844.0",
      "zod@3.25.76",
    ]);
    const startPlanJob = vi.fn(async (input: any) => ({
      job: jobRow({
        id: "job-new",
        status: "planning",
        operation: input.operation,
        release_version: input.releaseVersion,
        manifest_digest: input.manifestDigest,
        desired_config_version: input.desiredConfigVersion,
        plan_summary: { desiredConfig: input.desiredConfig },
      }),
      events: [],
    }));

    const result = (await updateN8nPluginPackageSettings(
      null,
      {
        input: {
          installId,
          customPackageSpecs: [
            "zod@3.25.76",
            "@aws-sdk/client-s3@3.844.0",
            "zod@3.25.76",
          ],
          expectedCurrentDigest: current.digest,
          idempotencyKey: "n8n-packages-1",
        },
      },
      CTX,
      {
        db: fakeDb({
          app: appRow({
            selected_release_version: "2026.06.19",
            selected_manifest_digest: "a".repeat(64),
            desired_config: {
              customPackageSpecs: ["lodash@4.17.21"],
              packageConfigDigest: current.digest,
              packageImageUri:
                "123456789012.dkr.ecr.us-east-1.amazonaws.com/n8n@sha256:old",
              packageImageConfigDigest: current.digest,
              imageUri: "public.ecr.aws/n8nio/n8n@sha256:" + "1".repeat(64),
            },
          }),
        }),
        pluginDeps: pluginDeps(),
        startPlanJob,
      },
    )) as Record<string, any>;

    expect(startPlanJob).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        requestedByUserId: USER_ID,
        appKey: "n8n",
        operation: "UPGRADE",
        idempotencyKey: "n8n-packages-1",
        releaseVersion: "2026.06.19",
        manifestDigest: "a".repeat(64),
        desiredConfig: expect.objectContaining({
          customPackageSpecs: next.packageSpecs,
          packageConfigDigest: next.digest,
        }),
      }),
      {},
    );
    const desiredConfig = startPlanJob.mock.calls[0][0].desiredConfig;
    expect(desiredConfig.packageImageUri).toBeUndefined();
    expect(desiredConfig.packageImageConfigDigest).toBeUndefined();
    expect(result.settings.currentPackageConfig.packageSpecs).toEqual(
      next.packageSpecs,
    );
    expect(result.deploymentJob.id).toBe("job-new");
  });

  it("rejects stale expected digests before creating a plan", async () => {
    const startPlanJob = vi.fn();
    await expect(
      updateN8nPluginPackageSettings(
        null,
        {
          input: {
            installId,
            customPackageSpecs: ["zod@3.25.76"],
            expectedCurrentDigest: "0".repeat(64),
            idempotencyKey: "n8n-packages-stale",
          },
        },
        CTX,
        {
          db: fakeDb({
            app: appRow({
              desired_config: { customPackageSpecs: ["lodash@4.17.21"] },
            }),
          }),
          pluginDeps: pluginDeps(),
          startPlanJob,
        },
      ),
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
    expect(startPlanJob).not.toHaveBeenCalled();
  });

  it("rejects invalid package specs before creating a plan", async () => {
    const startPlanJob = vi.fn();
    await expect(
      updateN8nPluginPackageSettings(
        null,
        {
          input: {
            installId,
            customPackageSpecs: ["lodash"],
            idempotencyKey: "n8n-packages-invalid",
          },
        },
        CTX,
        {
          db: fakeDb({ app: appRow() }),
          pluginDeps: pluginDeps(),
          startPlanJob,
        },
      ),
    ).rejects.toThrow(/must include an exact public npm version/);
    expect(startPlanJob).not.toHaveBeenCalled();
  });

  it("keeps an approved package image when the normalized digest is unchanged", async () => {
    const current = normalizeN8nPackageConfig(["lodash@4.17.21"]);
    const packageImageUri =
      "123456789012.dkr.ecr.us-east-1.amazonaws.com/n8n@sha256:old";
    const startPlanJob = vi.fn(async (input: any) => ({
      job: jobRow({
        id: "job-same",
        operation: input.operation,
        plan_summary: { desiredConfig: input.desiredConfig },
      }),
      events: [],
    }));

    await updateN8nPluginPackageSettings(
      null,
      {
        input: {
          installId,
          customPackageSpecs: ["lodash@4.17.21", "lodash@4.17.21"],
          expectedCurrentDigest: current.digest,
          idempotencyKey: "n8n-packages-same",
        },
      },
      CTX,
      {
        db: fakeDb({
          app: appRow({
            desired_config: {
              customPackageSpecs: ["lodash@4.17.21"],
              packageConfigDigest: current.digest,
              packageImageUri,
              packageImageConfigDigest: current.digest,
            },
          }),
        }),
        pluginDeps: pluginDeps(),
        startPlanJob,
      },
    );

    expect(startPlanJob.mock.calls[0][0].desiredConfig).toMatchObject({
      customPackageSpecs: current.packageSpecs,
      packageConfigDigest: current.digest,
      packageImageUri,
      packageImageConfigDigest: current.digest,
    });
  });

  it("rejects idempotency-key reuse with a different planned package digest", async () => {
    const current = normalizeN8nPackageConfig([]);
    const previous = normalizeN8nPackageConfig(["lodash@4.17.21"]);
    const startPlanJob = vi.fn(async () => ({
      job: jobRow({
        id: "job-existing",
        plan_summary: {
          desiredConfig: {
            customPackageSpecs: previous.packageSpecs,
            packageConfigDigest: previous.digest,
          },
        },
      }),
      events: [],
    }));

    await expect(
      updateN8nPluginPackageSettings(
        null,
        {
          input: {
            installId,
            customPackageSpecs: ["zod@3.25.76"],
            expectedCurrentDigest: current.digest,
            idempotencyKey: "n8n-packages-reused",
          },
        },
        CTX,
        {
          db: fakeDb({
            app: appRow({
              desired_config: {
                customPackageSpecs: [],
                packageConfigDigest: current.digest,
              },
            }),
          }),
          pluginDeps: pluginDeps(),
          startPlanJob,
        },
      ),
    ).rejects.toMatchObject({ extensions: { code: "CONFLICT" } });
  });

  it("requires tenant admin", async () => {
    mockRequireTenantAdmin.mockRejectedValue(
      new GraphQLError("Forbidden", { extensions: { code: "FORBIDDEN" } }),
    );
    await expect(
      updateN8nPluginPackageSettings(
        null,
        {
          input: {
            installId,
            customPackageSpecs: ["zod@3.25.76"],
            idempotencyKey: "n8n-packages-auth",
          },
        },
        CTX,
        { db: fakeDb({ app: appRow() }), pluginDeps: pluginDeps() },
      ),
    ).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
  });

  it("fails clearly when the managed application row is missing", async () => {
    const startPlanJob = vi.fn();
    await expect(
      updateN8nPluginPackageSettings(
        null,
        {
          input: {
            installId,
            customPackageSpecs: ["zod@3.25.76"],
            idempotencyKey: "n8n-packages-missing-app",
          },
        },
        CTX,
        {
          db: fakeDb({ app: null }),
          pluginDeps: pluginDeps(),
          startPlanJob,
        },
      ),
    ).rejects.toMatchObject({
      extensions: { code: "FAILED_PRECONDITION" },
    });
    expect(startPlanJob).not.toHaveBeenCalled();
  });
});

function pluginDeps(): PluginEngineDeps {
  return {
    store,
    resolveVersion: vi.fn() as never,
    handlers: {} as never,
    premiumAccess: {} as never,
    deleteSecrets: vi.fn() as never,
  };
}

function fakeDb({
  app = appRow(),
  latestJob = null,
  recentRuns = [],
}: {
  app?: Record<string, unknown> | null;
  latestJob?: Record<string, unknown> | null;
  recentRuns?: Record<string, unknown>[];
}) {
  selectQueue.push(app ? [app] : [], latestJob ? [latestJob] : [], recentRuns);
  return {
    select: vi.fn(() => {
      const chain: any = {
        from: vi.fn(() => chain),
        where: vi.fn(() => chain),
        orderBy: vi.fn(() => chain),
        limit: vi.fn(async () => selectQueue.shift() ?? []),
      };
      return chain;
    }),
  } as never;
}

function appRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-19T12:00:00.000Z");
  return {
    id: "app-n8n",
    tenant_id: TENANT_ID,
    key: "n8n",
    display_name: "n8n",
    desired_status: "enabled",
    current_status: "running",
    desired_config: {},
    selected_release_version: "2026.06.19",
    selected_manifest_digest: "a".repeat(64),
    last_job_id: "job-last",
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function jobRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-19T12:00:00.000Z");
  return {
    id: "job-last",
    tenant_id: TENANT_ID,
    application_id: "app-n8n",
    app_key: "n8n",
    operation: "UPGRADE",
    status: "awaiting_approval",
    idempotency_key: "idem",
    requested_by_user_id: USER_ID,
    release_version: "2026.06.19",
    manifest_digest: "a".repeat(64),
    desired_config_version: "v1",
    state_machine_arn: null,
    plan_execution_arn: null,
    apply_execution_arn: null,
    codebuild_build_arn: null,
    plan_digest: null,
    plan_summary: {},
    data_impact: {},
    evidence_bucket: "evidence-bucket",
    evidence_prefix: "tenant-1/n8n/job-last/plan",
    approval_required: true,
    approved_by_user_id: null,
    approved_at: null,
    rejected_by_user_id: null,
    rejected_at: null,
    error_message: null,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}

function runRow(overrides: Record<string, unknown> = {}) {
  const now = new Date("2026-06-19T12:00:00.000Z");
  return {
    id: "run-1",
    tenant_id: TENANT_ID,
    plugin_install_id: installId,
    managed_application_id: "app-n8n",
    space_id: "space-1",
    agent_id: "agent-1",
    thread_id: "thread-1",
    thread_turn_id: "turn-1",
    opening_message_id: "message-1",
    status: "waiting",
    resume_status: "not_ready",
    workflow_id: "workflow-1",
    workflow_name: "Order triage",
    execution_id: "execution-1",
    step_id: "agent-step",
    correlation_id: "corr-1",
    request_id: "request-1",
    idempotency_key: "idem-secret",
    instructions_preview: "Investigate the order",
    input_preview: '{"orderId":"123"}',
    request_metadata: {},
    resume_url_secret_ref: "secret-ref",
    resume_url_host: "n8n.example.test",
    resume_url_path: "/webhook-waiting/token",
    timeout_seconds: 3600,
    expires_at: now,
    result_payload: null,
    output_payload: null,
    error_payload: null,
    summary: null,
    links: { threadUrl: "/threads/thread-1" },
    resume_attempt_count: 0,
    next_resume_attempt_at: null,
    last_resume_attempt_at: null,
    last_resume_http_status: null,
    last_resume_error: null,
    resumed_at: null,
    terminal_at: null,
    accepted_at: now,
    created_at: now,
    updated_at: now,
    ...overrides,
  };
}
