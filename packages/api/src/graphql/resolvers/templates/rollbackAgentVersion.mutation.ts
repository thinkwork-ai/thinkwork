/**
 * Roll back an agent to a previously snapshotted version.
 *
 * Before applying the rollback, snapshots the agent's CURRENT state so the
 * rollback itself is reversible ("roll forward again").
 */

import type { GraphQLContext } from "../../context.js";
import { db, eq, agents, agentToCamel } from "../../utils.js";
import { snapshotAgent, restoreAgentFromSnapshot } from "../../../lib/agent-snapshot.js";

export async function rollbackAgentVersion(_parent: any, args: any, ctx: GraphQLContext) {
	const { agentId, versionId } = args;

	// 1. Snapshot current state (label as pre-rollback)
	await snapshotAgent(agentId, "Pre-rollback", ctx.auth.principalId);

	// 2. Restore from the target version
	await restoreAgentFromSnapshot(agentId, versionId);

	// 3. Regenerate workspace map
	try {
		const { regenerateWorkspaceMap } = await import("../../../lib/workspace-map-generator.js");
		regenerateWorkspaceMap(agentId).catch((err: unknown) => {
			console.error("[rollbackAgentVersion] regenerateWorkspaceMap failed:", err);
		});
	} catch (err) {
		console.warn("[rollbackAgentVersion] workspace-map-generator not available:", err);
	}

	// 4. Return updated agent
	const [updated] = await db.select().from(agents).where(eq(agents.id, agentId));
	return agentToCamel(updated);
}
