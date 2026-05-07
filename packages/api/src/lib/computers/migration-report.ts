export interface ComputerMigrationAgentCandidate {
  id: string;
  tenant_id: string;
  name: string;
  slug: string | null;
  human_pair_id: string | null;
  human_name?: string | null;
  human_email?: string | null;
  template_id: string;
  template_kind: string | null;
  template_name?: string | null;
  template_slug?: string | null;
  adapter_type?: string | null;
  workspace_run_count?: number | null;
  thread_count?: number | null;
  last_thread_at?: Date | string | null;
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
  owner?: {
    id: string;
    name: string | null;
    email: string | null;
  } | null;
  status: ComputerMigrationGroupStatus;
  severity: "ready" | "info" | "warning" | "blocker";
  recommendedAction:
    | "create_computer"
    | "skip_existing"
    | "resolve_blocker"
    | "leave_as_agent";
  applyDisposition: "create" | "skip" | "refuse";
  primaryAgentId: string | null;
  primaryAgent?: {
    id: string;
    name: string;
    slug: string | null;
    templateId: string;
    templateName: string | null;
    templateKind: string | null;
    lastHeartbeatAt: Date | string | null;
  } | null;
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
        owner: null,
        status: "missing_human_pair",
        severity: "info",
        recommendedAction: "leave_as_agent",
        applyDisposition: "skip",
        primaryAgentId: null,
        primaryAgent: agentSummary(agent),
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
    const sorted = [...candidates].sort(compareComputerSourcePriority);
    const primary = sorted[0]!;
    const existing = existingByOwner.get(ownerUserId);
    if (existing?.migrated_from_agent_id === primary.id) {
      groups.push({
        tenantId: primary.tenant_id,
        ownerUserId,
        owner: ownerSummary(primary),
        status: "already_migrated",
        severity: "info",
        recommendedAction: "skip_existing",
        applyDisposition: "skip",
        primaryAgentId: primary.id,
        primaryAgent: agentSummary(primary),
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
        owner: ownerSummary(primary),
        status: "existing_computer_conflict",
        severity: "blocker",
        recommendedAction: "resolve_blocker",
        applyDisposition: "refuse",
        primaryAgentId: primary.id,
        primaryAgent: agentSummary(primary),
        agentIds: sorted.map((agent) => agent.id),
        existingComputerId: existing.id,
        reasons: ["User already has an active Computer from another source"],
      });
      continue;
    }
    groups.push({
      tenantId: primary.tenant_id,
      ownerUserId,
      owner: ownerSummary(primary),
      status: "ready",
      severity: "ready",
      recommendedAction: "create_computer",
      applyDisposition: "create",
      primaryAgentId: primary.id,
      primaryAgent: agentSummary(primary),
      agentIds: sorted.map((agent) => agent.id),
      reasons: migrationReasons(sorted),
    });
  }

  return {
    tenantId: input.tenantId,
    dryRun: input.dryRun ?? true,
    summary: summarize(groups),
    groups,
  };
}

function migrationReasons(agents: ComputerMigrationAgentCandidate[]): string[] {
  const [primary, ...delegated] = agents;
  const reasons = ["Ready to create one Computer for this user"];
  if (primary?.template_kind !== "computer") {
    reasons.push(
      "Source Agent uses a legacy Agent Template and will be cloned as a Computer",
    );
  }
  if (delegated.length > 0) {
    reasons.push(
      `${delegated.length} additional user-paired Agent(s) remain as delegated Agents`,
    );
  }
  return reasons;
}

function ownerSummary(agent: ComputerMigrationAgentCandidate) {
  if (!agent.human_pair_id) return null;
  return {
    id: agent.human_pair_id,
    name: agent.human_name ?? null,
    email: agent.human_email ?? null,
  };
}

function agentSummary(agent: ComputerMigrationAgentCandidate) {
  return {
    id: agent.id,
    name: agent.name,
    slug: agent.slug,
    templateId: agent.template_id,
    templateName: agent.template_name ?? null,
    templateKind: agent.template_kind,
    lastHeartbeatAt: agent.last_heartbeat_at,
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

function compareComputerSourcePriority(
  a: ComputerMigrationAgentCandidate,
  b: ComputerMigrationAgentCandidate,
): number {
  const workspaceScoreDelta = workspaceScore(b) - workspaceScore(a);
  if (workspaceScoreDelta !== 0) return workspaceScoreDelta;

  const adapterDelta = adapterScore(b) - adapterScore(a);
  if (adapterDelta !== 0) return adapterDelta;

  return timestampValue(b) - timestampValue(a);
}

function workspaceScore(agent: ComputerMigrationAgentCandidate): number {
  return (
    Number(agent.workspace_run_count ?? 0) * 1_000 +
    Number(agent.thread_count ?? 0)
  );
}

function adapterScore(agent: ComputerMigrationAgentCandidate): number {
  return agent.adapter_type ? 1 : 0;
}

function timestampValue(agent: ComputerMigrationAgentCandidate): number {
  const value =
    agent.last_thread_at ??
    agent.last_heartbeat_at ??
    agent.updated_at ??
    agent.created_at;
  return value ? new Date(value).getTime() : 0;
}
