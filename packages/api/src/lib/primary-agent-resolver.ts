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
 *
 * Plan: docs/plans/2026-05-09-006-feat-computer-customization-page-plan.md U1.
 */

import { computers, db, eq } from "../graphql/utils.js";

export class NoPrimaryAgentError extends Error {
  constructor(public computerId: string) {
    super(
      `No primary agent could be resolved for computer ${computerId}. ` +
        `Set primary_agent_id or migrated_from_agent_id before using per-Agent bindings.`,
    );
    this.name = "NoPrimaryAgentError";
  }
}

export class ComputerNotFoundError extends Error {
  constructor(public computerId: string) {
    super(`Computer ${computerId} not found.`);
    this.name = "ComputerNotFoundError";
  }
}

export interface ComputerRow {
  id: string;
  tenant_id: string;
  owner_user_id: string | null;
  primary_agent_id: string | null;
  migrated_from_agent_id: string | null;
}

/**
 * Test seam — production callers use the `db`-backed default below.
 */
export interface PrimaryAgentResolverDeps {
  loadComputer: (id: string) => Promise<ComputerRow | null>;
}

const productionDeps: PrimaryAgentResolverDeps = {
  loadComputer: async (id) => {
    const rows = await db
      .select({
        id: computers.id,
        tenant_id: computers.tenant_id,
        owner_user_id: computers.owner_user_id,
        primary_agent_id: computers.primary_agent_id,
        migrated_from_agent_id: computers.migrated_from_agent_id,
      })
      .from(computers)
      .where(eq(computers.id, id))
      .limit(1);
    return rows[0] ?? null;
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
  throw new NoPrimaryAgentError(computerId);
}
