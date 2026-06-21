import { GraphQLError } from "graphql";
import {
  workflowEngineBindings,
  workflowVersions,
  workflows,
} from "@thinkwork/database-pg/schema";
import { eq } from "drizzle-orm";
import type { GraphQLContext } from "../../context.js";
import { db as defaultDb, randomUUID, snakeToCamel } from "../../utils.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import {
  assertSafeN8nWorkflowLocation,
  fetchN8nWorkflow,
  parseN8nWorkflowLocation,
  type N8nWorkflowFetchResult,
} from "../../../lib/routines/n8n/workflow-importer.js";
import {
  mapN8nWorkflowToDraft,
  type N8nWorkflowDraftDiagnostic,
} from "../../../lib/routines/n8n/workflow-mapper.js";
import { buildRoutineArtifactsFromPlan } from "../../../lib/routines/routine-authoring-planner.js";
import type { N8nWorkflow } from "../../../lib/routines/n8n/workflow-types.js";
import {
  loadN8nImportAuth,
  requireConfiguredN8nBaseUrl,
  type N8nImportAuth,
} from "./n8n-import-auth.js";

interface ImportN8nWorkflowDraftInput {
  tenantId: string;
  workflowUrl: string;
  name?: string | null;
  description?: string | null;
  n8nCredentialSlug?: string | null;
  pdiCredentialSlug?: string | null;
}

type WorkflowDb = typeof defaultDb;

type DraftCreateResult = {
  workflow: Record<string, unknown>;
  workflowVersion: Record<string, unknown>;
  binding: Record<string, unknown>;
  diagnostics: N8nWorkflowDraftDiagnostic[];
  credentialRequirements: Array<Record<string, unknown>>;
  sourceMetadata: Record<string, unknown>;
  activationBlocked: boolean;
};

export async function importN8nWorkflowDraft(
  _parent: unknown,
  args: { input: ImportN8nWorkflowDraftInput },
  ctx: GraphQLContext,
  deps: {
    db?: WorkflowDb;
    loadAuth?: typeof loadN8nImportAuth;
    fetchWorkflow?: typeof fetchN8nWorkflow;
    createDraft?: typeof createN8nWorkflowImportDraft;
  } = {},
): Promise<DraftCreateResult> {
  const input = args.input;
  await requireAdminOrApiKeyCaller(ctx, input.tenantId, "create_workflow");

  const auth = await (deps.loadAuth ?? loadN8nImportAuth)({
    tenantId: input.tenantId,
    credentialSlug: input.n8nCredentialSlug,
    required: true,
  });
  if (!auth) {
    throw new GraphQLError("n8n credential was not found", {
      extensions: { code: "BAD_USER_INPUT" },
    });
  }
  const configuredBaseUrl = requireConfiguredN8nBaseUrl(auth);
  const location = parseN8nWorkflowLocation(input.workflowUrl);
  assertSafeN8nWorkflowLocation(location, {
    allowedBaseUrl: configuredBaseUrl,
  });

  let fetched: N8nWorkflowFetchResult | null = null;
  let fetchError: Error | null = null;
  try {
    fetched = await (deps.fetchWorkflow ?? fetchN8nWorkflow)({
      workflowUrl: input.workflowUrl,
      auth,
      constraints: { allowedBaseUrl: configuredBaseUrl },
    });
  } catch (err) {
    fetchError = err as Error;
  }

  return (deps.createDraft ?? createN8nWorkflowImportDraft)(
    deps.db ?? defaultDb,
    {
      tenantId: input.tenantId,
      workflowUrl: input.workflowUrl,
      fetchedFrom: fetched?.endpoint ?? null,
      sourceWorkflowId: fetched?.workflow.id ?? location.workflowId,
      workflow:
        fetched?.workflow ??
        minimalWorkflow(location.workflowId, input.name?.trim() || null),
      fetchError,
      name: input.name?.trim() || undefined,
      description: input.description?.trim() || undefined,
      n8nAuth: auth,
      configuredBaseUrl,
      pdiCredentialSlug: input.pdiCredentialSlug?.trim() || "pdi-soap",
      createId: randomUUID,
    },
  );
}

export async function createN8nWorkflowImportDraft(
  database: WorkflowDb,
  input: {
    tenantId: string;
    workflowUrl: string;
    fetchedFrom: string | null;
    sourceWorkflowId: string | null;
    workflow: N8nWorkflow;
    fetchError: Error | null;
    name?: string;
    description?: string;
    n8nAuth: N8nImportAuth;
    configuredBaseUrl: string;
    pdiCredentialSlug: string;
    createId?: () => string;
  },
): Promise<DraftCreateResult> {
  const draft = input.fetchError
    ? fetchFailureDraft(input)
    : successfulDraft(input);
  const now = new Date();
  const workflowName = input.name || draft.workflowName;
  const workflowDescription =
    input.description ??
    `Imported n8n workflow draft for ${draft.workflowName}.`;
  const slug = `n8n-import-${slugSegment(workflowName)}-${(
    input.createId ?? randomUUID
  )()
    .replace(/-/g, "")
    .slice(0, 8)}`;
  const activationBlocked = draft.diagnostics.some(
    (diagnostic) => diagnostic.severity === "blocker",
  );
  const readinessState = activationBlocked ? "blocked_not_ready" : "unknown";
  const readinessReasons = draft.diagnostics.map((diagnostic) => ({
    code: diagnostic.code,
    severity: diagnostic.severity,
    message: diagnostic.message,
    nodeId: diagnostic.nodeId ?? null,
    nodeName: diagnostic.nodeName ?? null,
    nodeType: diagnostic.nodeType ?? null,
  }));
  const capabilities = {
    start: false,
    monitor: true,
    cancel: false,
    retry: false,
    replay: false,
    evidence: true,
    importDraft: true,
  };
  const sourceMetadata = {
    source: "n8n_import",
    workflowUrl: input.workflowUrl,
    fetchedFrom: input.fetchedFrom,
    externalWorkflowId: input.sourceWorkflowId,
    externalWorkflowName: draft.workflowName,
    credentialSlug: input.n8nAuth.credentialSlug,
    configuredBaseUrl: input.configuredBaseUrl,
    importedAt: now.toISOString(),
  };
  const definitionSnapshot = {
    importMode: "draft",
    sourceWorkflow: {
      id: input.sourceWorkflowId,
      name: draft.workflowName,
      nodeCount: input.workflow.nodes.length,
    },
    mappedPlan: draft.plan,
    routineArtifacts: draft.routineArtifacts,
    diagnostics: draft.diagnostics,
    activationBlocked,
  };

  const [workflow] = await database
    .insert(workflows)
    .values({
      tenant_id: input.tenantId,
      name: workflowName,
      slug,
      description: workflowDescription,
      lifecycle_status: "draft",
      visibility: "tenant_shared",
      primary_trigger_family: "n8n",
      capability_flags: capabilities,
      readiness_state: readinessState,
      readiness_reasons: readinessReasons,
      created_at: now,
      updated_at: now,
    })
    .returning();

  const [workflowVersion] = await database
    .insert(workflowVersions)
    .values({
      tenant_id: input.tenantId,
      workflow_id: workflow.id,
      version_number: 1,
      version_status: "draft",
      source_kind: "n8n_import",
      source_metadata: sourceMetadata,
      definition_snapshot: definitionSnapshot,
      capability_snapshot: capabilities,
      created_at: now,
    })
    .returning();

  await database
    .update(workflows)
    .set({
      current_version_id: workflowVersion.id,
      current_version_number: 1,
      updated_at: now,
    })
    .where(eq(workflows.id, workflow.id));

  const [binding] = await database
    .insert(workflowEngineBindings)
    .values({
      tenant_id: input.tenantId,
      workflow_id: workflow.id,
      workflow_version_id: workflowVersion.id,
      binding_type: "n8n_import",
      binding_status: activationBlocked ? "blocked_not_ready" : "configured",
      external_workflow_id: input.sourceWorkflowId,
      external_workflow_name: draft.workflowName,
      connection_ref: {
        source: "n8n_import",
        workflowUrl: input.workflowUrl,
        fetchedFrom: input.fetchedFrom,
        credentialSlug: input.n8nAuth.credentialSlug,
        configuredBaseUrl: input.configuredBaseUrl,
      },
      capability_flags: capabilities,
      readiness_state: readinessState,
      readiness_reasons: readinessReasons,
      created_at: now,
      updated_at: now,
    })
    .returning();

  return {
    workflow: snakeToCamel({
      ...workflow,
      current_version_id: workflowVersion.id,
      current_version_number: 1,
    }) as Record<string, unknown>,
    workflowVersion: snakeToCamel(workflowVersion) as Record<string, unknown>,
    binding: snakeToCamel(binding) as Record<string, unknown>,
    diagnostics: draft.diagnostics,
    credentialRequirements: draft.credentialRequirements,
    sourceMetadata,
    activationBlocked,
  };
}

function successfulDraft(input: {
  workflow: N8nWorkflow;
  name?: string;
  description?: string;
  pdiCredentialSlug: string;
}) {
  const mapped = mapN8nWorkflowToDraft(input.workflow, {
    name: input.name,
    description: input.description,
    credentialMappings: { PDIApi: input.pdiCredentialSlug },
  });
  const artifacts = mapped.plan
    ? buildRoutineArtifactsFromPlan(mapped.plan)
    : null;
  const artifactDiagnostics: N8nWorkflowDraftDiagnostic[] =
    artifacts && !artifacts.ok
      ? [
          {
            code: "artifact_build_failed",
            severity: "blocker",
            message: artifacts.reason,
          },
        ]
      : [];
  return {
    workflowName: mapped.workflowName,
    plan: mapped.plan,
    routineArtifacts: artifacts?.ok
      ? {
          asl: artifacts.artifacts.asl,
          markdownSummary: artifacts.artifacts.markdownSummary,
          stepManifest: artifacts.artifacts.stepManifest,
        }
      : null,
    diagnostics: [...mapped.diagnostics, ...artifactDiagnostics],
    credentialRequirements: mapped.credentialRequirements,
  };
}

function fetchFailureDraft(input: {
  workflow: N8nWorkflow;
  fetchError: Error | null;
}) {
  const diagnostics: N8nWorkflowDraftDiagnostic[] = [
    {
      code: "n8n_fetch_failed",
      severity: "blocker",
      message:
        input.fetchError?.message ||
        "Thinkwork could not fetch the n8n workflow.",
    },
  ];
  return {
    workflowName: input.workflow.name || "Unfetched n8n workflow",
    plan: null,
    routineArtifacts: null,
    diagnostics,
    credentialRequirements: [],
  };
}

function minimalWorkflow(workflowId: string, name: string | null): N8nWorkflow {
  return {
    id: workflowId,
    name: name || workflowId,
    nodes: [],
    connections: {},
  };
}

function slugSegment(value: string): string {
  const slug = value
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 48);
  return slug || "workflow";
}
