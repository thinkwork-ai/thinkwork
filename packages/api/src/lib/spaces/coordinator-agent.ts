import { and, eq, or } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agentWakeupRequests,
  agents,
  spaceAgentAssignments,
  spaces,
} from "@thinkwork/database-pg/schema";

export type CoordinatorWakeupReason =
  | "kickoff_triage"
  | "progress_review"
  | "completion_summary";

export interface CoordinatorAssignment {
  assignmentId: string;
  tenantId: string;
  spaceId: string;
  agentId: string;
  agentName: string;
  agentSlug: string | null;
  localRole: string | null;
  localInstructions: string | null;
  allowedCapabilities: unknown;
  allowedTools: unknown;
  spaceName: string;
  spacePrompt: string | null;
}

export interface CoordinatorWakeupInput {
  tenantId: string;
  spaceId: string;
  threadId: string;
  reason: CoordinatorWakeupReason;
  idempotencyKey?: string | null;
  summary?: string | null;
  requestedBy?: {
    type: "system" | "user" | "agent";
    id?: string | null;
  } | null;
}

export type CoordinatorWakeupResult =
  | {
      ok: true;
      enqueued: true;
      wakeupRequestId: string;
      agentId: string;
      assignmentId: string;
    }
  | {
      ok: true;
      enqueued: false;
      reason: "coordinator_assignment_not_found" | "already_enqueued";
      wakeupRequestId?: string;
      agentId?: string;
      assignmentId?: string;
    };

export interface CoordinatorAgentRepository {
  findCoordinatorAssignment(input: {
    tenantId: string;
    spaceId: string;
  }): Promise<CoordinatorAssignment | null>;
  findExistingWakeup(input: {
    tenantId: string;
    agentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string } | null>;
  createWakeup(input: {
    tenantId: string;
    agentId: string;
    source: string;
    reason: string;
    triggerDetail: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    requestedByActorType: string;
    requestedByActorId: string | null;
  }): Promise<{ id: string }>;
}

export interface CoordinatorAgentService {
  resolveAssignment(input: {
    tenantId: string;
    spaceId: string;
  }): Promise<CoordinatorAssignment | null>;
  enqueueWakeup(
    input: CoordinatorWakeupInput,
  ): Promise<CoordinatorWakeupResult>;
}

export interface CoordinatorAgentServiceDeps {
  repository?: CoordinatorAgentRepository;
}

export function createCoordinatorAgentService(
  deps: CoordinatorAgentServiceDeps = {},
): CoordinatorAgentService {
  const repository = deps.repository ?? new DrizzleCoordinatorAgentRepository();
  return {
    resolveAssignment(input) {
      return repository.findCoordinatorAssignment(input);
    },
    async enqueueWakeup(input) {
      const assignment = await repository.findCoordinatorAssignment(input);
      if (!assignment) {
        return {
          ok: true,
          enqueued: false,
          reason: "coordinator_assignment_not_found",
        };
      }

      const idempotencyKey =
        input.idempotencyKey ??
        `space-coordinator:${input.tenantId}:${input.threadId}:${input.reason}`;
      const existing = await repository.findExistingWakeup({
        tenantId: input.tenantId,
        agentId: assignment.agentId,
        idempotencyKey,
      });
      if (existing) {
        return {
          ok: true,
          enqueued: false,
          reason: "already_enqueued",
          wakeupRequestId: existing.id,
          agentId: assignment.agentId,
          assignmentId: assignment.assignmentId,
        };
      }

      const wakeup = await repository.createWakeup({
        tenantId: input.tenantId,
        agentId: assignment.agentId,
        source: "automation",
        reason: coordinatorReasonText(input.reason),
        triggerDetail: `space:${input.spaceId}:thread:${input.threadId}`,
        payload: {
          threadId: input.threadId,
          spaceId: input.spaceId,
          coordinatorAssignmentId: assignment.assignmentId,
          wakeupReason: input.reason,
          message: buildCoordinatorMessage(assignment, input),
          spaceContext: {
            spaceName: assignment.spaceName,
            spacePrompt: assignment.spacePrompt,
            localRole: assignment.localRole,
            localInstructions: assignment.localInstructions,
            allowedCapabilities: assignment.allowedCapabilities,
            allowedTools: assignment.allowedTools,
          },
        },
        idempotencyKey,
        requestedByActorType: input.requestedBy?.type ?? "system",
        requestedByActorId: input.requestedBy?.id ?? null,
      });

      return {
        ok: true,
        enqueued: true,
        wakeupRequestId: wakeup.id,
        agentId: assignment.agentId,
        assignmentId: assignment.assignmentId,
      };
    },
  };
}

function coordinatorReasonText(reason: CoordinatorWakeupReason): string {
  if (reason === "kickoff_triage") {
    return "Customer onboarding kickoff triage";
  }
  if (reason === "completion_summary") {
    return "Customer onboarding completion summary";
  }
  return "Customer onboarding progress review";
}

function buildCoordinatorMessage(
  assignment: CoordinatorAssignment,
  input: CoordinatorWakeupInput,
): string {
  const lines = [
    coordinatorReasonText(input.reason),
    "",
    `Space: ${assignment.spaceName}`,
    `Thread ID: ${input.threadId}`,
  ];
  if (input.summary) lines.push("", input.summary);
  if (assignment.spacePrompt) {
    lines.push("", "Space prompt:", assignment.spacePrompt);
  }
  if (assignment.localInstructions) {
    lines.push("", "Coordinator instructions:", assignment.localInstructions);
  }
  if (input.reason === "kickoff_triage") {
    lines.push(
      "",
      "Review the kickoff context, identify missing facts, ambiguous owners, or blockers, and post a concise next-step note in the Thread.",
    );
  } else if (input.reason === "completion_summary") {
    lines.push(
      "",
      "All required linked tasks are complete. Prepare a final summary and archive recommendation for the humans; do not archive automatically.",
    );
  } else {
    lines.push(
      "",
      "Review linked task progress and post only useful blocker or next-step updates.",
    );
  }
  return lines.join("\n");
}

class DrizzleCoordinatorAgentRepository implements CoordinatorAgentRepository {
  private readonly db = getDb();

  async findCoordinatorAssignment(input: {
    tenantId: string;
    spaceId: string;
  }): Promise<CoordinatorAssignment | null> {
    const [row] = await this.db
      .select({
        assignmentId: spaceAgentAssignments.id,
        tenantId: spaceAgentAssignments.tenant_id,
        spaceId: spaceAgentAssignments.space_id,
        agentId: agents.id,
        agentName: agents.name,
        agentSlug: agents.slug,
        localRole: spaceAgentAssignments.local_role,
        localInstructions: spaceAgentAssignments.local_instructions,
        allowedCapabilities: spaceAgentAssignments.allowed_capabilities,
        allowedTools: spaceAgentAssignments.allowed_tools,
        spaceName: spaces.name,
        spacePrompt: spaces.prompt,
      })
      .from(spaceAgentAssignments)
      .innerJoin(agents, eq(spaceAgentAssignments.agent_id, agents.id))
      .innerJoin(spaces, eq(spaceAgentAssignments.space_id, spaces.id))
      .where(
        and(
          eq(spaceAgentAssignments.tenant_id, input.tenantId),
          eq(spaceAgentAssignments.space_id, input.spaceId),
          eq(spaceAgentAssignments.status, "active"),
          eq(spaces.status, "active"),
          or(
            eq(spaceAgentAssignments.local_role, "coordinator"),
            eq(agents.slug, "coordinator"),
          ),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async findExistingWakeup(input: {
    tenantId: string;
    agentId: string;
    idempotencyKey: string;
  }): Promise<{ id: string } | null> {
    const [row] = await this.db
      .select({ id: agentWakeupRequests.id })
      .from(agentWakeupRequests)
      .where(
        and(
          eq(agentWakeupRequests.tenant_id, input.tenantId),
          eq(agentWakeupRequests.agent_id, input.agentId),
          eq(agentWakeupRequests.idempotency_key, input.idempotencyKey),
        ),
      )
      .limit(1);
    return row ?? null;
  }

  async createWakeup(input: {
    tenantId: string;
    agentId: string;
    source: string;
    reason: string;
    triggerDetail: string;
    payload: Record<string, unknown>;
    idempotencyKey: string;
    requestedByActorType: string;
    requestedByActorId: string | null;
  }): Promise<{ id: string }> {
    const [row] = await this.db
      .insert(agentWakeupRequests)
      .values({
        tenant_id: input.tenantId,
        agent_id: input.agentId,
        source: input.source,
        reason: input.reason,
        trigger_detail: input.triggerDetail,
        payload: input.payload,
        idempotency_key: input.idempotencyKey,
        requested_by_actor_type: input.requestedByActorType,
        requested_by_actor_id: input.requestedByActorId,
      })
      .returning({ id: agentWakeupRequests.id });
    if (!row) {
      throw new Error("Failed to create coordinator wakeup");
    }
    return row;
  }
}
