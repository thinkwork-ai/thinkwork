/**
 * Cron: Check Agent Health
 *
 * Finds agents with status='error' or status='offline' and logs them.
 * Placeholder for future restart logic (e.g., re-invoking AgentCore runtimes).
 *
 * Schedule: every 2 minutes
 */

import { or, eq } from "drizzle-orm";
import { agents } from "@thinkwork/database-pg/schema";
import { getDb } from "@thinkwork/database-pg";

export async function handler() {
	const db = getDb();

	const unhealthyAgents = await db
		.select({
			id: agents.id,
			name: agents.name,
			tenant_id: agents.tenant_id,
			status: agents.status,
			type: agents.type,
			last_heartbeat_at: agents.last_heartbeat_at,
		})
		.from(agents)
		.where(
			or(
				eq(agents.status, "error"),
				eq(agents.status, "offline"),
			),
		);

	if (unhealthyAgents.length > 0) {
		console.log(`Found ${unhealthyAgents.length} unhealthy agents`, {
			agents: unhealthyAgents.map((a) => ({
				id: a.id,
				name: a.name,
				tenant_id: a.tenant_id,
				status: a.status,
				type: a.type,
				last_heartbeat_at: a.last_heartbeat_at,
			})),
		});

		// TODO: Implement restart logic
		// - For AgentCore-managed agents, re-invoke the runtime
		// - For BYOB gateways, send a health-check ping
		// - Respect cooldown periods to avoid restart storms
	} else {
		console.log("All agents healthy");
	}

	return { unhealthy: unhealthyAgents.length };
}
