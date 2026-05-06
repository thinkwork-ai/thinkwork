export interface ComputerMigrationAgentCandidate {
  id: string;
  tenant_id: string;
  name: string;
  slug: string | null;
  human_pair_id: string | null;
  template_id: string;
  template_kind: string | null;
  runtime_config: unknown;
  budget_monthly_cents: number | null;
  spent_monthly_cents: number | null;
  last_heartbeat_at: Date | string | null;
  updated_at: Date | string | null;
  created_at: Date | string | null;
}

export interface ExistingComputerCandidate {
  id: string;
  tenant_id: string;
  owner_user_id: string;
  migrated_from_agent_id: string | null;
  status: string;
}

export type ComputerMigrationGroupStatus =
  | "ready"
  | "already_migrated"
  | "multiple_candidates"
  | "existing_computer_conflict"
  | "missing_human_pair"
  | "template_not_computer";

export interface ComputerMigrationGroup {
  tenantId: string;
  ownerUserId: string | null;
  status: ComputerMigrationGroupStatus;
  primaryAgentId: string | null;
  agentIds: string[];
  existingComputerId?: string;
  reasons: string[];
}

export interface ComputerMigrationReport {
  tenantId: string;
  dryRun: boolean;
  summary: Record<ComputerMigrationGroupStatus, number>;
  groups: ComputerMigrationGroup[];
}

export function buildComputerMigrationReport(input: {
  tenantId: string;
  agents: ComputerMigrationAgentCandidate[];
  existingComputers: ExistingComputerCandidate[];
  dryRun?: boolean;
}): ComputerMigrationReport {
  const existingByOwner = new Map(
    input.existingComputers
      .filter((computer) => computer.status !== "archived")
      .map((computer) => [computer.owner_user_id, computer]),
  );
  const byOwner = new Map<string, ComputerMigrationAgentCandidate[]>();
  const groups: ComputerMigrationGroup[] = [];

  for (const agent of input.agents) {
    if (!agent.human_pair_id) {
      groups.push({
        tenantId: agent.tenant_id,
        ownerUserId: null,
        status: "missing_human_pair",
        primaryAgentId: null,
        agentIds: [agent.id],
        reasons: ["Agent has no human_pair_id and remains a delegated worker"],
      });
      continue;
    }
    const bucket = byOwner.get(agent.human_pair_id) ?? [];
    bucket.push(agent);
    byOwner.set(agent.human_pair_id, bucket);
  }

  for (const [ownerUserId, candidates] of byOwner.entries()) {
    const sorted = [...candidates].sort(compareMostRecentlyActive);
    const primary = sorted[0]!;
    const existing = existingByOwner.get(ownerUserId);
    if (existing?.migrated_from_agent_id === primary.id) {
      groups.push({
        tenantId: primary.tenant_id,
        ownerUserId,
        status: "already_migrated",
        primaryAgentId: primary.id,
        agentIds: sorted.map((agent) => agent.id),
        existingComputerId: existing.id,
        reasons: ["Computer already exists for the selected source Agent"],
      });
      continue;
    }
    if (existing) {
      groups.push({
        tenantId: primary.tenant_id,
        ownerUserId,
        status: "existing_computer_conflict",
        primaryAgentId: primary.id,
        agentIds: sorted.map((agent) => agent.id),
        existingComputerId: existing.id,
        reasons: ["User already has an active Computer from another source"],
      });
      continue;
    }
    if (sorted.length > 1) {
      groups.push({
        tenantId: primary.tenant_id,
        ownerUserId,
        status: "multiple_candidates",
        primaryAgentId: primary.id,
        agentIds: sorted.map((agent) => agent.id),
        reasons: [
          "Multiple user-paired Agents exist for one user; resolve before apply",
        ],
      });
      continue;
    }
    if (primary.template_kind !== "computer") {
      groups.push({
        tenantId: primary.tenant_id,
        ownerUserId,
        status: "template_not_computer",
        primaryAgentId: primary.id,
        agentIds: [primary.id],
        reasons: ["Source Agent template is not typed as a Computer Template"],
      });
      continue;
    }
    groups.push({
      tenantId: primary.tenant_id,
      ownerUserId,
      status: "ready",
      primaryAgentId: primary.id,
      agentIds: [primary.id],
      reasons: ["Ready to create one Computer for this user"],
    });
  }

  return {
    tenantId: input.tenantId,
    dryRun: input.dryRun ?? true,
    summary: summarize(groups),
    groups,
  };
}

function summarize(
  groups: ComputerMigrationGroup[],
): Record<ComputerMigrationGroupStatus, number> {
  const summary: Record<ComputerMigrationGroupStatus, number> = {
    ready: 0,
    already_migrated: 0,
    multiple_candidates: 0,
    existing_computer_conflict: 0,
    missing_human_pair: 0,
    template_not_computer: 0,
  };
  for (const group of groups) summary[group.status]++;
  return summary;
}

function compareMostRecentlyActive(
  a: ComputerMigrationAgentCandidate,
  b: ComputerMigrationAgentCandidate,
): number {
  return timestampValue(b) - timestampValue(a);
}

function timestampValue(agent: ComputerMigrationAgentCandidate): number {
  const value = agent.last_heartbeat_at ?? agent.updated_at ?? agent.created_at;
  return value ? new Date(value).getTime() : 0;
}
