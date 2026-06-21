/**
 * Workflow operations for the admin-ops MCP surface.
 *
 * These wrappers expose ThinkWork workflow identity to agents without leaking
 * backend-specific identifiers such as Routine ids, Step Functions ARNs, n8n
 * URLs, or CRM object ids into the tool contract.
 */

import type { AdminOpsClient } from "./client.js";

const WORKFLOW_FIELDS = `
  id
  tenantId
  name
  description
  lifecycleStatus
  visibility
  ownerAgentId
  primaryTriggerFamily
  currentVersionNumber
  capabilityFlags
  readinessState
  readinessReasons
  lastRunAt
` as const;

const WORKFLOW_RUN_FIELDS = `
  id
  tenantId
  workflowId
  status
  triggerFamily
  triggerSource
  actorType
  actorId
  idempotencyKey
  correlationId
  backendExecutionId
  backendExecutionRef
  readinessSnapshot
  startedAt
  lastEventAt
  errorCode
  errorMessage
` as const;

export type WorkflowVisibility = "agent_private" | "tenant_shared";

export interface Workflow {
  id: string;
  tenantId: string;
  name: string;
  description: string | null;
  lifecycleStatus: string;
  visibility: WorkflowVisibility;
  ownerAgentId: string | null;
  primaryTriggerFamily: string;
  currentVersionNumber: number | null;
  capabilityFlags: Record<string, unknown>;
  readinessState: string;
  readinessReasons: unknown[];
  lastRunAt: string | null;
}

export interface WorkflowRunLite {
  id: string;
  tenantId: string;
  workflowId: string;
  status: string;
  triggerFamily: string;
  triggerSource: string | null;
  actorType: string | null;
  actorId: string | null;
  idempotencyKey: string | null;
  correlationId: string | null;
  backendExecutionId: string | null;
  backendExecutionRef: Record<string, unknown>;
  readinessSnapshot: Record<string, unknown>;
  startedAt: string | null;
  lastEventAt: string | null;
  errorCode: string | null;
  errorMessage: string | null;
}

export interface ListWorkflowsInput {
  tenantId: string;
  limit?: number;
}

export async function listWorkflows(
  client: AdminOpsClient,
  input: ListWorkflowsInput,
): Promise<Workflow[]> {
  const data = await client.graphql<{ workflows: Workflow[] }>(
    `query($tenantId: ID!, $limit: Int) {
       workflows(tenantId: $tenantId, lifecycleStatus: active, limit: $limit) {
         ${WORKFLOW_FIELDS}
       }
     }`,
    { tenantId: input.tenantId, limit: input.limit ?? 100 },
  );
  return data.workflows;
}

export async function getWorkflow(
  client: AdminOpsClient,
  id: string,
): Promise<Workflow | null> {
  const data = await client.graphql<{ workflow: Workflow | null }>(
    `query($id: ID!) { workflow(id: $id) { ${WORKFLOW_FIELDS} } }`,
    { id },
  );
  return data.workflow ?? null;
}

export interface TriggerWorkflowRunInput {
  workflowId: string;
  args?: Record<string, unknown>;
  agentId?: string;
  idempotencyKey?: string;
}

export async function triggerWorkflowRun(
  client: AdminOpsClient,
  input: TriggerWorkflowRunInput,
): Promise<WorkflowRunLite> {
  const data = await client.graphql<{ triggerWorkflowRun: WorkflowRunLite }>(
    `mutation($input: TriggerWorkflowRunInput!) {
       triggerWorkflowRun(input: $input) { ${WORKFLOW_RUN_FIELDS} }
     }`,
    {
      input: {
        workflowId: input.workflowId,
        input: input.args ? JSON.stringify(input.args) : null,
        idempotencyKey: input.idempotencyKey ?? null,
        triggerSource: "admin_ops_mcp",
        actorType: "agent",
        actorId: input.agentId ?? null,
        agentId: input.agentId ?? null,
      },
    },
  );
  return data.triggerWorkflowRun;
}

export interface WorkflowVisibilityCheckResult {
  ok: boolean;
  reason?:
    | "not_found"
    | "private_to_other_agent"
    | "different_tenant"
    | "workflow_not_active"
    | "workflow_not_startable";
}

export function checkWorkflowVisibility(
  workflow: Workflow | null,
  caller: { tenantId: string; agentId: string },
): WorkflowVisibilityCheckResult {
  if (!workflow) return { ok: false, reason: "not_found" };
  if (workflow.tenantId !== caller.tenantId) {
    return { ok: false, reason: "different_tenant" };
  }
  if (workflow.lifecycleStatus !== "active") {
    return { ok: false, reason: "workflow_not_active" };
  }
  if (workflow.capabilityFlags?.start === false) {
    return { ok: false, reason: "workflow_not_startable" };
  }
  if (workflow.visibility === "tenant_shared") {
    return { ok: true };
  }
  if (workflow.ownerAgentId === caller.agentId) {
    return { ok: true };
  }
  return { ok: false, reason: "private_to_other_agent" };
}
