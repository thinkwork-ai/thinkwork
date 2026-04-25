import { sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";

export type AgentLeaseKind = "shared" | "exclusive";

export interface AgentLease {
  agentId: string;
  leaseId: string;
  leaseKind: AgentLeaseKind;
}

export interface AcquireLeaseOptions {
  ownerKind?: string;
  ownerId?: string | null;
  timeoutMs?: number;
  leaseTtlMs?: number;
  retryDelayMs?: number;
}

const DEFAULT_TIMEOUT_MS = 30_000;
const DEFAULT_LEASE_TTL_MS = 15 * 60_000;
const DEFAULT_RETRY_DELAY_MS = 250;

class LeaseBusy extends Error {
  constructor() {
    super("agent operation lease is busy");
  }
}

export class AgentLeaseTimeoutError extends Error {
  constructor(agentId: string, kind: AgentLeaseKind) {
    super(`Timed out acquiring ${kind} lease for agent ${agentId}`);
  }
}

export async function acquireShared(
  agentId: string,
  options: AcquireLeaseOptions = {},
): Promise<AgentLease> {
  return acquireLease(agentId, "shared", options);
}

export async function acquireExclusive(
  agentId: string,
  options: AcquireLeaseOptions = {},
): Promise<AgentLease> {
  return acquireLease(agentId, "exclusive", options);
}

export async function heartbeat(
  agentId: string,
  leaseId: string,
  leaseTtlMs = DEFAULT_LEASE_TTL_MS,
): Promise<void> {
  const result = await getDb().execute(sql`
		UPDATE agent_operation_leases
		SET last_heartbeat_at = now(),
		    expires_at = now() + (${leaseTtlMs}::int * interval '1 millisecond')
		WHERE agent_id = ${agentId}::uuid
		  AND lease_id = ${leaseId}::uuid
		  AND expires_at > now()
		RETURNING lease_id
	`);
  if (rowsOf(result).length === 0) {
    throw new Error(
      `Lease ${leaseId} for agent ${agentId} is no longer active`,
    );
  }
}

export async function release(agentId: string, leaseId: string): Promise<void> {
  await getDb().execute(sql`
		DELETE FROM agent_operation_leases
		WHERE agent_id = ${agentId}::uuid
		  AND lease_id = ${leaseId}::uuid
	`);
}

async function acquireLease(
  agentId: string,
  leaseKind: AgentLeaseKind,
  options: AcquireLeaseOptions,
): Promise<AgentLease> {
  const timeoutMs = options.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const retryDelayMs = options.retryDelayMs ?? DEFAULT_RETRY_DELAY_MS;
  const startedAt = Date.now();
  let lastError: unknown;

  while (Date.now() - startedAt <= timeoutMs) {
    try {
      return await tryAcquireLease(agentId, leaseKind, options);
    } catch (err) {
      if (!(err instanceof LeaseBusy)) throw err;
      lastError = err;
      await sleep(retryDelayMs);
    }
  }

  if (lastError instanceof LeaseBusy) {
    throw new AgentLeaseTimeoutError(agentId, leaseKind);
  }
  throw new AgentLeaseTimeoutError(agentId, leaseKind);
}

async function tryAcquireLease(
  agentId: string,
  leaseKind: AgentLeaseKind,
  options: AcquireLeaseOptions,
): Promise<AgentLease> {
  const ownerKind = options.ownerKind ?? "unknown";
  const ownerId = options.ownerId ?? null;
  const leaseTtlMs = options.leaseTtlMs ?? DEFAULT_LEASE_TTL_MS;
  const db = getDb();

  return await db.transaction(async (tx) => {
    const agentLock = await tx.execute(sql`
			SELECT id
			FROM agents
			WHERE id = ${agentId}::uuid
			FOR UPDATE
		`);
    if (rowsOf(agentLock).length === 0) {
      throw new Error(`Agent ${agentId} not found`);
    }

    await tx.execute(sql`
			DELETE FROM agent_operation_leases
			WHERE agent_id = ${agentId}::uuid
			  AND expires_at <= now()
		`);

    const active = await tx.execute(sql`
			SELECT lease_kind
			FROM agent_operation_leases
			WHERE agent_id = ${agentId}::uuid
			  AND expires_at > now()
		`);
    const activeRows = rowsOf(active) as Array<{ lease_kind?: string }>;
    const incompatible =
      leaseKind === "exclusive"
        ? activeRows.length > 0
        : activeRows.some((row) => row.lease_kind === "exclusive");
    if (incompatible) throw new LeaseBusy();

    const inserted = await tx.execute(sql`
			INSERT INTO agent_operation_leases
				(agent_id, lease_kind, owner_kind, owner_id, expires_at)
			VALUES
				(
					${agentId}::uuid,
					${leaseKind},
					${ownerKind},
					${ownerId},
					now() + (${leaseTtlMs}::int * interval '1 millisecond')
				)
			RETURNING lease_id, lease_kind
		`);
    const row = rowsOf(inserted)[0] as
      | { lease_id?: string; lease_kind?: AgentLeaseKind }
      | undefined;
    if (!row?.lease_id) {
      throw new Error("agent_operation_leases insert returned no lease_id");
    }
    return {
      agentId,
      leaseId: row.lease_id,
      leaseKind: row.lease_kind ?? leaseKind,
    };
  });
}

function rowsOf(result: unknown): unknown[] {
  return ((result as { rows?: unknown[] } | null)?.rows ?? []) as unknown[];
}

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
