import type { GraphQLContext } from "../../context.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { createRoutine } from "./createRoutine.mutation.js";
import { fetchN8nWorkflow } from "../../../lib/routines/n8n/workflow-importer.js";
import { mapN8nWorkflowToRoutinePlan } from "../../../lib/routines/n8n/workflow-mapper.js";
import { buildRoutineArtifactsFromPlan } from "../../../lib/routines/routine-authoring-planner.js";
import { loadN8nImportAuth } from "../workflows/n8n-import-auth.js";

interface ImportN8nRoutineInput {
  tenantId: string;
  workflowUrl: string;
  name?: string | null;
  description?: string | null;
  n8nCredentialSlug?: string | null;
  pdiCredentialSlug?: string | null;
}

export async function importN8nRoutine(
  _parent: unknown,
  args: { input: ImportN8nRoutineInput },
  ctx: GraphQLContext,
): Promise<unknown> {
  const input = args.input;
  await requireAdminOrApiKeyCaller(ctx, input.tenantId, "create_routine");

  const n8nAuth = await loadN8nImportAuth({
    tenantId: input.tenantId,
    credentialSlug: input.n8nCredentialSlug,
    required: false,
  });
  const fetched = await fetchN8nWorkflow({
    workflowUrl: input.workflowUrl,
    auth: n8nAuth ?? undefined,
    constraints: {
      allowedBaseUrl: n8nAuth?.configuredBaseUrl,
    },
  });

  const mapped = mapN8nWorkflowToRoutinePlan(fetched.workflow, {
    name: input.name?.trim() || undefined,
    description: input.description?.trim() || undefined,
    credentialMappings: {
      PDIApi: input.pdiCredentialSlug?.trim() || "pdi-soap",
    },
  });
  if (!mapped.ok) throw new Error(mapped.reason);

  const artifacts = buildRoutineArtifactsFromPlan({
    ...mapped.plan,
    metadata: {
      ...(mapped.plan.metadata ?? {}),
      sourceImport: {
        kind: "n8n",
        workflowUrl: input.workflowUrl,
        fetchedFrom: fetched.endpoint,
      },
    },
  });
  if (!artifacts.ok) throw new Error(artifacts.reason);

  return createRoutine(
    _parent,
    {
      input: {
        tenantId: input.tenantId,
        visibility: "tenant_shared",
        name: artifacts.artifacts.plan.title,
        description: artifacts.artifacts.plan.description,
        asl: artifacts.artifacts.asl,
        markdownSummary: artifacts.artifacts.markdownSummary,
        stepManifest: artifacts.artifacts.stepManifest,
      },
    },
    ctx,
  );
}
