/**
 * Routine operations for the admin-ops MCP surface (Plan 2026-05-01-006 §U11).
 *
 * Mirrors the agents/teams/tenants module shape: thin GraphQL wrappers
 * over the Phase B U7 mutations (`createRoutine`, `triggerRoutineRun`).
 * The MCP tool definitions in `packages/lambda/admin-ops-mcp.ts` import
 * from here so the dispatch path is mechanical.
 *
 * Visibility model (v0):
 *   - `agentId` set on a routine = private to that agent
 *   - `agentId` null = tenant-shared
 * The MCP `routine_invoke` tool enforces that the caller's agentId
 * matches `routine.agentId` (or that the routine is tenant-shared)
 * before invoking. A first-class `visibility` enum + `owning_agent_id`
 * column is a Phase E schema follow-up.
 */

import type { AdminOpsClient } from "./client.js";

const ROUTINE_FIELDS = `
  id
  tenantId
  agentId
  name
  description
  status
  engine
  currentVersion
  createdAt
` as const;

export interface Routine {
  id: string;
  tenantId: string;
  agentId: string | null;
  name: string;
  description: string | null;
  status: string;
  engine: string;
  currentVersion: number | null;
  createdAt: string;
}

export interface RoutineExecutionLite {
  id: string;
  status: string;
  triggerSource: string;
  startedAt: string | null;
}

// ---------------------------------------------------------------------------
// Reads — used by visibility check + agents listing their routines.
// ---------------------------------------------------------------------------

export async function getRoutine(
  client: AdminOpsClient,
  id: string,
): Promise<Routine | null> {
  const data = await client.graphql<{ routine: Routine | null }>(
    `query($id: ID!) { routine(id: $id) { ${ROUTINE_FIELDS} } }`,
    { id },
  );
  return data.routine ?? null;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateAgentRoutineInput {
  tenantId: string;
  /** Owning agent. The routine is "agent-stamped" — the agent that
   * called create_routine. */
  agentId: string;
  name: string;
  description?: string;
  /** Operator-facing markdown summary. agent-stamp builds this from
   * the agent's intent + suggested-step list. */
  markdownSummary: string;
}

/** Placeholder ASL for newly-created agent-stamped routines. The agent
 * iterates the routine via the chat builder + publishRoutineVersion
 * after the initial create. Mirrors apps/admin/src/routes/.../new.tsx. */
const PLACEHOLDER_ASL = JSON.stringify({
  Comment: "Agent-stamped draft routine — awaiting iteration",
  StartAt: "NoOp",
  States: { NoOp: { Type: "Succeed" } },
});

export async function createAgentRoutine(
  client: AdminOpsClient,
  input: CreateAgentRoutineInput,
): Promise<Routine> {
  const data = await client.graphql<{ createRoutine: Routine }>(
    `mutation($input: CreateRoutineInput!) {
       createRoutine(input: $input) { ${ROUTINE_FIELDS} }
     }`,
    {
      input: {
        tenantId: input.tenantId,
        agentId: input.agentId,
        name: input.name,
        description: input.description ?? null,
        asl: PLACEHOLDER_ASL,
        markdownSummary: input.markdownSummary,
        stepManifest: JSON.stringify({}),
      },
    },
  );
  return data.createRoutine;
}

export interface TriggerRoutineRunInput {
  routineId: string;
  args?: Record<string, unknown>;
}

/** Execute a routine. v0 returns a lite execution row; the agent can
 * subsequently poll routineExecution(id) for the full lifecycle. */
export async function triggerRoutineRun(
  client: AdminOpsClient,
  input: TriggerRoutineRunInput,
): Promise<RoutineExecutionLite> {
  const data = await client.graphql<{ triggerRoutineRun: RoutineExecutionLite }>(
    `mutation($routineId: ID!, $input: AWSJSON) {
       triggerRoutineRun(routineId: $routineId, input: $input) {
         id
         status
         triggerSource
         startedAt
       }
     }`,
    {
      routineId: input.routineId,
      input: input.args ? JSON.stringify(input.args) : null,
    },
  );
  return data.triggerRoutineRun;
}

// ---------------------------------------------------------------------------
// Visibility / ownership check (v0 = agentId match or tenant-shared)
// ---------------------------------------------------------------------------

export interface VisibilityCheckResult {
  ok: boolean;
  /** Populated when ok=false. */
  reason?:
    | "not_found"
    | "private_to_other_agent"
    | "different_tenant";
}

export function checkRoutineVisibility(
  routine: Routine | null,
  caller: { tenantId: string; agentId: string },
): VisibilityCheckResult {
  if (!routine) return { ok: false, reason: "not_found" };
  if (routine.tenantId !== caller.tenantId) {
    return { ok: false, reason: "different_tenant" };
  }
  // agentId === null means tenant-shared; any agent in the tenant can
  // invoke it. agentId set means private — only the owning agent.
  if (routine.agentId !== null && routine.agentId !== caller.agentId) {
    return { ok: false, reason: "private_to_other_agent" };
  }
  return { ok: true };
}
