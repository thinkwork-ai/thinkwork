import { and, db, eq, tenantCredentials } from "../../utils.js";
import type { GraphQLContext } from "../../context.js";
import { requireAdminOrApiKeyCaller } from "../core/authz.js";
import { createRoutine } from "./createRoutine.mutation.js";
import { fetchN8nWorkflow } from "../../../lib/routines/n8n/workflow-importer.js";
import { mapN8nWorkflowToRoutinePlan } from "../../../lib/routines/n8n/workflow-mapper.js";
import { buildRoutineArtifactsFromPlan } from "../../../lib/routines/routine-authoring-planner.js";
import { readTenantCredentialSecret } from "../../../lib/tenant-credentials/secret-store.js";

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

  const n8nAuth = await loadN8nAuth(input);
  const fetched = await fetchN8nWorkflow({
    workflowUrl: input.workflowUrl,
    auth: n8nAuth,
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

async function loadN8nAuth(input: ImportN8nRoutineInput): Promise<{
  apiKey?: string | null;
  bearerToken?: string | null;
}> {
  const slug = input.n8nCredentialSlug?.trim() || "n8n-api";
  const [credential] = await db
    .select()
    .from(tenantCredentials)
    .where(
      and(
        eq(tenantCredentials.tenant_id, input.tenantId),
        eq(tenantCredentials.slug, slug),
        eq(tenantCredentials.status, "active"),
      ),
    )
    .limit(1);
  if (!credential) return {};

  if (credential.kind !== "api_key" && credential.kind !== "bearer_token") {
    throw new Error(
      `n8n credential '${slug}' must be an api_key or bearer_token credential.`,
    );
  }

  const secret = await readTenantCredentialSecret(credential.secret_ref);
  if (credential.kind === "api_key") {
    return { apiKey: stringSecret(secret.apiKey, "apiKey", slug) };
  }
  return { bearerToken: stringSecret(secret.token, "token", slug) };
}

function stringSecret(value: unknown, field: string, slug: string): string {
  if (typeof value === "string" && value.trim()) return value.trim();
  throw new Error(
    `n8n credential '${slug}' is missing secret field '${field}'.`,
  );
}
