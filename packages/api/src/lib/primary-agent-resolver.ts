/**
 * Resolve the agent that anchors per-agent bindings (skills, MCP servers,
 * routines) for a given Computer. Surfaced through the Customize page —
 * `agent_skills`, `agent_mcp_servers`, and `routines` are keyed by `agent_id`,
 * but the Computer's UI seat does not directly know which agent is its
 * anchor.
 *
 * Resolution order:
 *   1. `computers.primary_agent_id` (set on creation or backfilled).
 *   2. `computers.migrated_from_agent_id` (legacy migration anchor).
 *   3. Lookup by `(tenant_id, owner_user_id, template_id)`. Throws when
 *      ambiguous (more than one match) or when nothing matches.
 *
 * Plan: docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md U1.
 */

import { agents, computers, db, and, eq } from "../graphql/utils.js";

export class NoPrimaryAgentError extends Error {
  constructor(public computerId: string) {
    super(
      `No primary agent could be resolved for computer ${computerId}. ` +
        `The Computer has no primary_agent_id, no migrated_from_agent_id, ` +
        `and no matching agent for (tenant_id, owner_user_id, template_id).`,
    );
    this.name = "NoPrimaryAgentError";
  }
}

export class AmbiguousPrimaryAgentError extends Error {
  constructor(
    public computerId: string,
    public matches: number,
  ) {
    super(
      `Ambiguous primary agent resolution for computer ${computerId}: ` +
        `${matches} agents match (tenant_id, owner_user_id, template_id). ` +
        `Set primary_agent_id explicitly to disambiguate.`,
    );
    this.name = "AmbiguousPrimaryAgentError";
  }
}

export class ComputerNotFoundError extends Error {
  constructor(public computerId: string) {
    super(`Computer ${computerId} not found.`);
    this.name = "ComputerNotFoundError";
  }
}

export class ComputerOwnerRequiredError extends Error {
  constructor(public computerId: string) {
    super(
      `Computer ${computerId} has no owner_user_id; set primary_agent_id or migrated_from_agent_id before using legacy owner-based primary agent resolution.`,
    );
    this.name = "ComputerOwnerRequiredError";
  }
}

export interface ComputerRow {
  id: string;
  tenant_id: string;
  owner_user_id: string | null;
  template_id: string;
  primary_agent_id: string | null;
  migrated_from_agent_id: string | null;
}

/**
 * Test seam — production callers use the `db`-backed default below.
 */
export interface PrimaryAgentResolverDeps {
  loadComputer: (id: string) => Promise<ComputerRow | null>;
  findCandidateAgentIds: (input: {
    tenantId: string;
    ownerUserId: string;
    templateId: string;
  }) => Promise<string[]>;
}

const productionDeps: PrimaryAgentResolverDeps = {
  loadComputer: async (id) => {
    const rows = await db
      .select({
        id: computers.id,
        tenant_id: computers.tenant_id,
        owner_user_id: computers.owner_user_id,
        template_id: computers.template_id,
        primary_agent_id: computers.primary_agent_id,
        migrated_from_agent_id: computers.migrated_from_agent_id,
      })
      .from(computers)
      .where(eq(computers.id, id))
      .limit(1);
    return rows[0] ?? null;
  },
  findCandidateAgentIds: async ({ tenantId, ownerUserId, templateId }) => {
    const rows = await db
      .select({ id: agents.id })
      .from(agents)
      .where(
        and(
          eq(agents.tenant_id, tenantId),
          eq(agents.template_id, templateId),
          eq(agents.human_pair_id, ownerUserId),
        ),
      );
    return rows.map((r) => r.id);
  },
};

export async function resolveComputerPrimaryAgentId(
  computerId: string,
  deps: PrimaryAgentResolverDeps = productionDeps,
): Promise<string> {
  const computer = await deps.loadComputer(computerId);
  if (!computer) {
    throw new ComputerNotFoundError(computerId);
  }
  if (computer.primary_agent_id) {
    return computer.primary_agent_id;
  }
  if (computer.migrated_from_agent_id) {
    return computer.migrated_from_agent_id;
  }
  if (!computer.owner_user_id) {
    throw new ComputerOwnerRequiredError(computerId);
  }
  const candidates = await deps.findCandidateAgentIds({
    tenantId: computer.tenant_id,
    ownerUserId: computer.owner_user_id,
    templateId: computer.template_id,
  });
  if (candidates.length === 0) {
    throw new NoPrimaryAgentError(computerId);
  }
  if (candidates.length > 1) {
    throw new AmbiguousPrimaryAgentError(computerId, candidates.length);
  }
  return candidates[0]!;
}
