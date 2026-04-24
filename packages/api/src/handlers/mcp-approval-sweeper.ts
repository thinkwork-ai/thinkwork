/**
 * mcp-approval-sweeper — daily TTL auto-reject for stale pending MCP servers.
 *
 * Plan §U11: plugin-installed MCP servers land as `status='pending'` and
 * sit in the admin approval queue. If nobody decides within 30 days the
 * row is auto-rejected so the queue reflects active decisions only.
 * Rejection is not terminal — an admin can still re-approve the row
 * later; the timestamp difference is the audit trail.
 *
 * Triggered by EventBridge (aws_scheduler_schedule `mcp-approval-sweeper`)
 * once per day. Has no HTTP surface.
 *
 * Constants:
 *   - PENDING_TTL_DAYS: 30
 *   - Batch size / pagination is unnecessary at our scale (thousands of
 *     tenants × handful of pending rows max); a single UPDATE is fine.
 */

import { and, eq, lt } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { tenantMcpServers } from "@thinkwork/database-pg/schema";

const PENDING_TTL_DAYS = 30;

export interface SweepResult {
  sweptAt: string;
  cutoff: string;
  auto_rejected: number;
  rows: Array<{ id: string; tenant_id: string; created_at: string }>;
}

export async function handler(): Promise<SweepResult> {
  const db = getDb();
  const now = new Date();
  const cutoff = new Date(
    now.getTime() - PENDING_TTL_DAYS * 24 * 60 * 60 * 1000,
  );

  const rejected = await db
    .update(tenantMcpServers)
    .set({
      status: "rejected",
      url_hash: null,
      approved_by: null,
      approved_at: null,
      updated_at: now,
    })
    .where(
      and(
        eq(tenantMcpServers.status, "pending"),
        lt(tenantMcpServers.created_at, cutoff),
      ),
    )
    .returning({
      id: tenantMcpServers.id,
      tenant_id: tenantMcpServers.tenant_id,
      created_at: tenantMcpServers.created_at,
    });

  const result: SweepResult = {
    sweptAt: now.toISOString(),
    cutoff: cutoff.toISOString(),
    auto_rejected: rejected.length,
    rows: rejected.map((r) => ({
      id: r.id,
      tenant_id: r.tenant_id,
      created_at: r.created_at.toISOString(),
    })),
  };

  if (result.auto_rejected > 0) {
    console.log(
      `[mcp-approval-sweeper] auto_rejected=${result.auto_rejected} cutoff=${result.cutoff}`,
      JSON.stringify(result.rows),
    );
  } else {
    console.log(
      `[mcp-approval-sweeper] no stale pending rows; cutoff=${result.cutoff}`,
    );
  }

  return result;
}
