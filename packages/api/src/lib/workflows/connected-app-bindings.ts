import { and, eq } from "drizzle-orm";
import {
  managedApplications,
  workflowEngineBindings,
  workflowTriggers,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";
import type { CustomerOnboardingSourceInput } from "../spaces/customer-onboarding-workflow.js";
import type { ManagedApplicationStatus } from "../../graphql/resolvers/core/managedApplications.js";
import { summarizeWorkflowEvidence } from "./evidence-redaction.js";
import { createWorkflowRunLedger } from "./run-ledger.js";
import { normalizeWorkflowTriggerContract } from "./trigger-contract.js";

type WorkflowDb = any;

export type ConnectedAppReadinessReason = {
  code: string;
  component: "workflow" | "managed_app" | "mcp" | "oauth" | "policy";
  severity: "info" | "warning" | "blocker";
  message: string;
};

export type ConnectedAppWorkflowReadiness = {
  state: "ready" | "blocked_not_ready" | "disabled";
  bindingStatus: "ready" | "blocked_not_ready" | "disabled";
  reasons: ConnectedAppReadinessReason[];
  capabilityFlags: Record<string, unknown>;
};

export type ConnectedAppCredentialState =
  | "tenant_managed"
  | "user_active"
  | "user_missing"
  | "user_expired";

export type TwentyCrmWorkflowProjectionInput = {
  tenantId: string;
  workflowEnabled?: boolean;
  managedApplication?: TwentyManagedApplicationProjection | null;
  managedApplicationId?: string | null;
  credentialState?: ConnectedAppCredentialState;
  policyBlocked?: boolean;
};

export type TwentyCrmWorkflowProjectionResult = {
  workflowId: string;
  workflowVersionId: string | null;
  bindingId: string;
  readiness: ConnectedAppWorkflowReadiness;
  created: boolean;
};

export type TwentyCrmWorkflowRunInput = TwentyCrmWorkflowProjectionInput & {
  opportunity: CustomerOnboardingSourceInput;
  thread?: {
    id: string;
    identifier?: string | null;
    title?: string | null;
  } | null;
  idempotent?: boolean;
  linkedTaskCount?: number;
  missingFields?: string[];
};

export type TwentyManagedApplicationProjection = Pick<
  ManagedApplicationStatus,
  | "key"
  | "status"
  | "provisioned"
  | "runtimeEnabled"
  | "url"
  | "managedMcpInstalled"
  | "managedMcpStatus"
  | "managedMcpMessage"
>;

export const TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_ID =
  "twenty:crm:customer_onboarding";

export const TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_NAME =
  "Customer onboarding from Twenty CRM";

export const TWENTY_CRM_WORKFLOW_CAPABILITIES = {
  sourceSystem: "twenty",
  bindingType: "twenty_crm",
  triggerFamilies: ["crm"],
  actions: ["create_customer_onboarding_thread", "mirror_checklist_tasks"],
  resources: ["opportunity", "customer", "thread", "checklist_item"],
  credentialRequirements: {
    tenantManagedApp: true,
    userOAuth: "optional_for_user_scoped_actions",
  },
  evidenceTypes: ["crm_event", "crm_object_snapshot", "thinkwork_thread"],
  start: false,
  monitor: true,
  cancel: false,
  retry: false,
  replay: false,
  evidence: true,
} as const;

export function twentyCrmWorkflowReadiness(
  input: Omit<TwentyCrmWorkflowProjectionInput, "tenantId">,
): ConnectedAppWorkflowReadiness {
  const reasons: ConnectedAppReadinessReason[] = [];
  const app = input.managedApplication;

  if (input.workflowEnabled === false) {
    reasons.push({
      code: "workflow_disabled",
      component: "workflow",
      severity: "blocker",
      message: "Twenty CRM workflow is disabled in ThinkWork.",
    });
    return readiness("disabled", reasons);
  }

  if (!app) {
    reasons.push({
      code: "managed_app_missing",
      component: "managed_app",
      severity: "blocker",
      message: "Twenty CRM managed application is not provisioned.",
    });
  } else if (app.status === "disabled") {
    reasons.push({
      code: "managed_app_destroyed",
      component: "managed_app",
      severity: "blocker",
      message:
        "Twenty CRM managed application is destroyed or disabled; workflow history remains available.",
    });
  } else if (!app.provisioned) {
    reasons.push({
      code: "managed_app_missing",
      component: "managed_app",
      severity: "blocker",
      message: "Twenty CRM managed application is not provisioned.",
    });
  } else if (app.status === "parked" || !app.runtimeEnabled) {
    reasons.push({
      code: "managed_app_parked",
      component: "managed_app",
      severity: "blocker",
      message:
        "Twenty CRM runtime is parked; workflows remain visible but cannot run.",
    });
  } else if (app.status !== "running") {
    reasons.push({
      code: "managed_app_unknown",
      component: "managed_app",
      severity: "blocker",
      message: "Twenty CRM runtime status is unknown.",
    });
  }

  if (app?.status === "running") {
    if (!app.managedMcpInstalled) {
      reasons.push({
        code: "mcp_server_missing",
        component: "mcp",
        severity: "blocker",
        message: "Twenty CRM MCP server is not registered for agents.",
      });
    } else if (
      !["installed", "plugin_managed"].includes(app.managedMcpStatus)
    ) {
      reasons.push({
        code: `mcp_server_${app.managedMcpStatus}`,
        component: "mcp",
        severity: "blocker",
        message:
          app.managedMcpMessage ??
          "Twenty CRM MCP server is not ready for workflow actions.",
      });
    }
  }

  if (input.credentialState === "user_missing") {
    reasons.push({
      code: "user_oauth_missing",
      component: "oauth",
      severity: "blocker",
      message:
        "User-scoped CRM action is missing an active user OAuth connection.",
    });
  } else if (input.credentialState === "user_expired") {
    reasons.push({
      code: "user_oauth_expired",
      component: "oauth",
      severity: "blocker",
      message: "User-scoped CRM action has an expired OAuth connection.",
    });
  }

  if (input.policyBlocked) {
    reasons.push({
      code: "policy_blocked",
      component: "policy",
      severity: "blocker",
      message: "Tenant workflow policy blocks this connected app action.",
    });
  }

  return readiness(
    reasons.length === 0 ? "ready" : "blocked_not_ready",
    reasons,
  );
}

export async function ensureTwentyCrmWorkflowBinding(
  database: WorkflowDb,
  input: TwentyCrmWorkflowProjectionInput,
): Promise<TwentyCrmWorkflowProjectionResult> {
  const app =
    input.managedApplication ??
    (await loadTwentyManagedApplicationProjection(database, input.tenantId));
  const managedApplicationId =
    input.managedApplicationId ??
    (await loadTwentyManagedApplicationId(database, input.tenantId));
  const projection = {
    ...input,
    managedApplication: app,
    managedApplicationId,
  };
  const readiness = twentyCrmWorkflowReadiness(projection);

  const existing = await dbSelect(database)
    .select({
      id: workflowEngineBindings.id,
      workflow_id: workflowEngineBindings.workflow_id,
      workflow_version_id: workflowEngineBindings.workflow_version_id,
    })
    .from(workflowEngineBindings)
    .where(
      and(
        eq(workflowEngineBindings.tenant_id, input.tenantId),
        eq(workflowEngineBindings.binding_type, "twenty_crm"),
        eq(
          workflowEngineBindings.external_workflow_id,
          TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_ID,
        ),
      ),
    )
    .limit(1);

  if (existing[0]) {
    await refreshTwentyCrmWorkflowProjection(database, {
      ...projection,
      workflowId: existing[0].workflow_id,
      bindingId: existing[0].id,
      workflowVersionId: existing[0].workflow_version_id,
      readiness,
    });
    return {
      workflowId: existing[0].workflow_id,
      workflowVersionId: existing[0].workflow_version_id ?? null,
      bindingId: existing[0].id,
      readiness,
      created: false,
    };
  }

  const workflowRows = await dbInsert(database)
    .insert(workflows)
    .values({
      tenant_id: input.tenantId,
      name: TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_NAME,
      slug: "twenty-crm-customer-onboarding",
      description:
        "Starts a ThinkWork customer onboarding Thread when a Twenty CRM opportunity closes won.",
      lifecycle_status: "active",
      visibility: "tenant_shared",
      primary_trigger_family: "crm",
      capability_flags: TWENTY_CRM_WORKFLOW_CAPABILITIES,
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
      source_kind: "twenty_crm",
      source_metadata: twentyCrmSourceMetadata(app),
      definition_snapshot: twentyCrmDefinitionSnapshot(),
      capability_snapshot: TWENTY_CRM_WORKFLOW_CAPABILITIES,
      published_at: new Date(),
    })
    .returning({ id: workflowVersions.id });
  const workflowVersionId = versionRows[0].id;

  await dbUpdate(database)
    .update(workflows)
    .set({
      current_version_id: workflowVersionId,
      current_version_number: 1,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, workflowId));

  const bindingRows = await dbInsert(database)
    .insert(workflowEngineBindings)
    .values({
      tenant_id: input.tenantId,
      workflow_id: workflowId,
      workflow_version_id: workflowVersionId,
      binding_type: "twenty_crm",
      binding_status: readiness.bindingStatus,
      managed_application_id: managedApplicationId,
      external_workflow_id: TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_ID,
      external_workflow_name: TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_NAME,
      connection_ref: {
        source: "twenty_managed_application",
        managedApplicationKey: "twenty",
        publicUrl: app?.url ?? null,
      },
      capability_flags: TWENTY_CRM_WORKFLOW_CAPABILITIES,
      readiness_state: readiness.state,
      readiness_reasons: readiness.reasons,
    })
    .returning({ id: workflowEngineBindings.id });
  const bindingId = bindingRows[0].id;

  await ensureTwentyCrmTrigger(database, {
    tenantId: input.tenantId,
    workflowId,
    workflowVersionId,
    readiness,
  });

  return { workflowId, workflowVersionId, bindingId, readiness, created: true };
}

export async function recordTwentyCrmWorkflowRun(
  database: WorkflowDb,
  input: TwentyCrmWorkflowRunInput,
): Promise<{ runId: string; created: boolean; readinessState: string }> {
  const projection = await ensureTwentyCrmWorkflowBinding(database, input);
  const opportunityId =
    stringValue(input.opportunity.opportunityId) ?? "unknown";
  const event =
    stringValue(input.opportunity.event) ?? "opportunity.closed_won";
  const occurredAt = normalizeDate(input.opportunity.occurredAt);
  const idempotencyKey = [
    "twenty-crm",
    event,
    opportunityId,
    occurredAt?.toISOString() ?? "undated",
  ].join(":");
  const trigger = normalizeWorkflowTriggerContract({
    family: "crm",
    source: "twenty:opportunity",
    actor: {
      type: "connected_app",
      externalId: "twenty",
      displayName: "Twenty CRM",
    },
    idempotencyKey,
    correlationId: `twenty:opportunity:${opportunityId}`,
    occurredAt,
    payload: {
      event,
      objectType: "opportunity",
      objectId: opportunityId,
      customerId: stringValue(input.opportunity.customerId),
      customerName:
        stringValue(input.opportunity.customerName) ??
        stringValue(input.opportunity.companyName),
      threadId: input.thread?.id ?? null,
      idempotent: input.idempotent ?? false,
      linkedTaskCount: input.linkedTaskCount ?? 0,
      missingFields: input.missingFields ?? [],
    },
  });
  const blocked = projection.readiness.state !== "ready";
  const evidenceSummary = summarizeWorkflowEvidence({
    payload: input.opportunity,
    summary: {
      sourceSystem: "twenty",
      event,
      objectType: "opportunity",
      objectId: opportunityId,
      occurredAt: occurredAt?.toISOString() ?? null,
      threadId: input.thread?.id ?? null,
    },
  });

  const result = await createWorkflowRunLedger(database, {
    tenantId: input.tenantId,
    workflowId: projection.workflowId,
    workflowVersionId: projection.workflowVersionId,
    engineBindingId: projection.bindingId,
    trigger,
    status: blocked ? "blocked_not_ready" : "succeeded",
    backendExecutionId: opportunityId,
    backendExecutionRef: {
      sourceSystem: "twenty",
      objectType: "opportunity",
      objectId: opportunityId,
      event,
      occurredAt: occurredAt?.toISOString() ?? null,
      threadId: input.thread?.id ?? null,
    },
    capabilitySnapshot: TWENTY_CRM_WORKFLOW_CAPABILITIES,
    readinessSnapshot: {
      state: projection.readiness.state,
      reasons: projection.readiness.reasons,
    },
    startedAt: occurredAt,
    initialEvent: {
      eventType: blocked ? "workflow.blocked_not_ready" : event,
      eventStatus: blocked ? "blocked_not_ready" : "succeeded",
      provenance: "app_callback",
      occurredAt,
      message: blocked
        ? "Twenty CRM workflow trigger was blocked because the connected app is not ready."
        : "Twenty CRM opportunity event recorded for customer onboarding.",
      payloadSummary: {
        event,
        objectId: opportunityId,
        threadId: input.thread?.id ?? null,
        readinessState: projection.readiness.state,
      },
      evidenceRef: {
        sourceSystem: "twenty",
        sourceId: opportunityId,
      },
    },
    evidence: [
      {
        evidenceType: "crm_event",
        sourceSystem: "twenty",
        sourceId: opportunityId,
        summary: evidenceSummary,
      },
      ...(input.thread?.id
        ? [
            {
              evidenceType: "thinkwork_thread",
              sourceSystem: "thinkwork",
              sourceId: input.thread.id,
              uri: `thinkwork://threads/${input.thread.id}`,
              summary: summarizeWorkflowEvidence({
                payload: {
                  threadId: input.thread.id,
                  identifier: input.thread.identifier ?? null,
                  title: input.thread.title ?? null,
                },
                summary: { sourceSystem: "thinkwork", objectType: "thread" },
              }),
            },
          ]
        : []),
    ],
  });

  return {
    runId: result.run.id,
    created: result.created,
    readinessState: projection.readiness.state,
  };
}

async function refreshTwentyCrmWorkflowProjection(
  database: WorkflowDb,
  input: TwentyCrmWorkflowProjectionInput & {
    workflowId: string;
    workflowVersionId: string | null;
    bindingId: string;
    readiness: ConnectedAppWorkflowReadiness;
  },
): Promise<void> {
  await dbUpdate(database)
    .update(workflows)
    .set({
      name: TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_NAME,
      lifecycle_status:
        input.workflowEnabled === false ? "deprecated" : "active",
      primary_trigger_family: "crm",
      capability_flags: TWENTY_CRM_WORKFLOW_CAPABILITIES,
      readiness_state: input.readiness.state,
      readiness_reasons: input.readiness.reasons,
      updated_at: new Date(),
    })
    .where(eq(workflows.id, input.workflowId));
  await dbUpdate(database)
    .update(workflowEngineBindings)
    .set({
      managed_application_id: input.managedApplicationId ?? null,
      binding_status: input.readiness.bindingStatus,
      connection_ref: {
        source: "twenty_managed_application",
        managedApplicationKey: "twenty",
        publicUrl: input.managedApplication?.url ?? null,
      },
      capability_flags: TWENTY_CRM_WORKFLOW_CAPABILITIES,
      readiness_state: input.readiness.state,
      readiness_reasons: input.readiness.reasons,
      updated_at: new Date(),
    })
    .where(eq(workflowEngineBindings.id, input.bindingId));
  await ensureTwentyCrmTrigger(database, {
    tenantId: input.tenantId,
    workflowId: input.workflowId,
    workflowVersionId: input.workflowVersionId,
    readiness: input.readiness,
  });
}

async function ensureTwentyCrmTrigger(
  database: WorkflowDb,
  input: {
    tenantId: string;
    workflowId: string;
    workflowVersionId: string | null;
    readiness: ConnectedAppWorkflowReadiness;
  },
): Promise<void> {
  const existing = await dbSelect(database)
    .select({ id: workflowTriggers.id })
    .from(workflowTriggers)
    .where(
      and(
        eq(workflowTriggers.workflow_id, input.workflowId),
        eq(workflowTriggers.trigger_family, "crm"),
      ),
    )
    .limit(1);
  const values = {
    workflow_version_id: input.workflowVersionId,
    source_system: "twenty",
    enabled: input.readiness.state === "ready",
    idempotency_required: true,
    trigger_config: {
      events: ["opportunity.closed_won", "opportunity.won"],
      objectType: "opportunity",
      debounceWindowSeconds: 60,
    },
    actor_contract: { actorType: "connected_app", source: "twenty" },
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
      trigger_family: "crm",
      ...values,
    });
}

async function loadTwentyManagedApplicationId(
  database: WorkflowDb,
  tenantId: string,
): Promise<string | null> {
  const [app] = await dbSelect(database)
    .select({ id: managedApplications.id })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.key, "twenty"),
      ),
    )
    .limit(1);
  return app?.id ?? null;
}

async function loadTwentyManagedApplicationProjection(
  database: WorkflowDb,
  tenantId: string,
): Promise<TwentyManagedApplicationProjection | null> {
  const [app] = await dbSelect(database)
    .select({
      id: managedApplications.id,
      desired_status: managedApplications.desired_status,
      current_status: managedApplications.current_status,
      desired_config: managedApplications.desired_config,
    })
    .from(managedApplications)
    .where(
      and(
        eq(managedApplications.tenant_id, tenantId),
        eq(managedApplications.key, "twenty"),
      ),
    )
    .limit(1);
  if (!app) return null;
  const desiredConfig = recordValue(app.desired_config);
  const running =
    app.desired_status === "enabled" &&
    ["running", "enabled", "succeeded"].includes(String(app.current_status));
  const parked = app.desired_status === "parked";
  const provisioned =
    running || parked || Boolean(stringValue(desiredConfig.publicUrl));
  return {
    key: "twenty",
    status: running ? "running" : parked ? "parked" : "disabled",
    provisioned,
    runtimeEnabled: running,
    url: running ? stringValue(desiredConfig.publicUrl) : null,
    managedMcpInstalled: false,
    managedMcpStatus: "missing",
    managedMcpMessage: null,
  };
}

function readiness(
  state: ConnectedAppWorkflowReadiness["state"],
  reasons: ConnectedAppReadinessReason[],
): ConnectedAppWorkflowReadiness {
  return {
    state,
    bindingStatus: state,
    reasons,
    capabilityFlags: TWENTY_CRM_WORKFLOW_CAPABILITIES,
  };
}

function twentyCrmSourceMetadata(
  app: TwentyManagedApplicationProjection | null,
) {
  return {
    source: "twenty_managed_application",
    externalWorkflowId: TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_ID,
    triggerFamily: "crm",
    appStatus: app?.status ?? "missing",
    publicUrl: app?.url ?? null,
  };
}

function twentyCrmDefinitionSnapshot() {
  return {
    name: TWENTY_CRM_CUSTOMER_ONBOARDING_WORKFLOW_NAME,
    sourceSystem: "twenty",
    events: ["opportunity.closed_won", "opportunity.won"],
    action: "create_customer_onboarding_thread",
  };
}

function normalizeDate(value: unknown): Date | null {
  if (!value) return null;
  if (value instanceof Date)
    return Number.isNaN(value.getTime()) ? null : value;
  if (typeof value !== "string") return null;
  const parsed = new Date(value);
  return Number.isNaN(parsed.getTime()) ? null : parsed;
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
