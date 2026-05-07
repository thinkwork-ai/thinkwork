import { and, eq, isNotNull, ne, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  agents,
  agentTemplates,
  agentWorkspaceRuns,
  computers,
  computerEvents,
  threads,
  users,
} from "@thinkwork/database-pg/schema";
import { generateSlug } from "@thinkwork/database-pg/utils/generate-slug";
import {
  buildComputerMigrationReport,
  type ComputerMigrationReport,
} from "./migration-report.js";

export interface ComputerMigrationOptions {
  tenantId: string;
  apply?: boolean;
}

export interface ComputerMigrationApplyResult {
  report: ComputerMigrationReport;
  created: string[];
  skipped: string[];
}

export class ComputerMigrationBlockedError extends Error {
  readonly statusCode = 409;

  constructor(
    message: string,
    readonly blockers: ComputerMigrationReport["groups"],
  ) {
    super(message);
    this.name = "ComputerMigrationBlockedError";
  }
}

const db = getDb();

export async function dryRunComputerMigration(
  options: ComputerMigrationOptions,
): Promise<ComputerMigrationReport> {
  return buildComputerMigrationReport({
    tenantId: options.tenantId,
    agents: await loadUserPairedAgents(options.tenantId),
    existingComputers: await loadExistingComputers(options.tenantId),
    dryRun: true,
  });
}

export async function applyComputerMigration(
  options: ComputerMigrationOptions,
): Promise<ComputerMigrationApplyResult> {
  const report = await dryRunComputerMigration(options);
  const blockers = report.groups.filter((group) =>
    ["existing_computer_conflict"].includes(group.status),
  );
  if (blockers.length > 0) {
    throw new ComputerMigrationBlockedError(
      `Computer migration has ${blockers.length} unresolved blocker group(s)`,
      blockers,
    );
  }

  const candidates = await loadUserPairedAgents(options.tenantId);
  const byId = new Map(
    candidates.map((candidate) => [candidate.id, candidate]),
  );
  const created: string[] = [];
  const skipped: string[] = [];

  for (const group of report.groups) {
    if (group.status === "already_migrated") {
      if (group.existingComputerId) skipped.push(group.existingComputerId);
      continue;
    }
    if (group.status !== "ready" || !group.primaryAgentId) continue;
    const agent = byId.get(group.primaryAgentId);
    if (!agent || !agent.human_pair_id) continue;

    const [row] = await db
      .insert(computers)
      .values({
        tenant_id: agent.tenant_id,
        owner_user_id: agent.human_pair_id,
        template_id: agent.template_id,
        name: agent.name,
        slug: `${agent.slug ?? generateSlug()}-computer`,
        runtime_config: agent.runtime_config,
        budget_monthly_cents: agent.budget_monthly_cents,
        spent_monthly_cents: agent.spent_monthly_cents,
        last_active_at:
          agent.last_thread_at ?? agent.last_heartbeat_at ?? agent.updated_at,
        migrated_from_agent_id: agent.id,
        migration_metadata: {
          source: "agent_to_computer_phase_one",
          sourceAgentId: agent.id,
          sourceAgentIds: group.agentIds,
          delegatedAgentIds: group.agentIds.filter((id) => id !== agent.id),
          sourceAgentTemplateId: agent.template_id,
          sourceAgentTemplateKind: agent.template_kind,
          sourceAgentTemplateName: agent.template_name ?? null,
        },
      })
      .returning({ id: computers.id });
    await db.insert(computerEvents).values({
      tenant_id: agent.tenant_id,
      computer_id: row.id,
      event_type: "agent_to_computer_migration_applied",
      level: "info",
      payload: {
        sourceAgentId: agent.id,
        sourceAgentName: agent.name,
        templateId: agent.template_id,
        templateName: agent.template_name ?? null,
      },
    });
    created.push(row.id);
  }

  return {
    report: {
      ...report,
      dryRun: false,
    },
    created,
    skipped,
  };
}

async function loadUserPairedAgents(tenantId: string) {
  return db
    .select({
      id: agents.id,
      tenant_id: agents.tenant_id,
      name: agents.name,
      slug: agents.slug,
      human_pair_id: agents.human_pair_id,
      human_name: users.name,
      human_email: users.email,
      template_id: agents.template_id,
      template_kind: agentTemplates.template_kind,
      template_name: agentTemplates.name,
      template_slug: agentTemplates.slug,
      adapter_type: agents.adapter_type,
      workspace_run_count: sql<number>`coalesce((
        select count(*)::int
        from ${agentWorkspaceRuns}
        where ${agentWorkspaceRuns.agent_id} = ${agents.id}
      ), 0)`,
      thread_count: sql<number>`coalesce((
        select count(*)::int
        from ${threads}
        where ${threads.agent_id} = ${agents.id}
      ), 0)`,
      last_thread_at: sql<Date | null>`(
        select max(${threads.updated_at})
        from ${threads}
        where ${threads.agent_id} = ${agents.id}
      )`,
      runtime_config: agents.runtime_config,
      budget_monthly_cents: agents.budget_monthly_cents,
      spent_monthly_cents: agents.spent_monthly_cents,
      last_heartbeat_at: agents.last_heartbeat_at,
      updated_at: agents.updated_at,
      created_at: agents.created_at,
    })
    .from(agents)
    .leftJoin(agentTemplates, eq(agents.template_id, agentTemplates.id))
    .leftJoin(users, eq(agents.human_pair_id, users.id))
    .where(
      and(
        eq(agents.tenant_id, tenantId),
        isNotNull(agents.human_pair_id),
        ne(agents.status, "archived"),
      ),
    );
}

async function loadExistingComputers(tenantId: string) {
  return db
    .select({
      id: computers.id,
      tenant_id: computers.tenant_id,
      owner_user_id: computers.owner_user_id,
      migrated_from_agent_id: computers.migrated_from_agent_id,
      status: computers.status,
    })
    .from(computers)
    .where(eq(computers.tenant_id, tenantId));
}
