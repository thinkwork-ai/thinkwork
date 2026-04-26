import type { GraphQLContext } from "../../context.js";
import { db, sql } from "../../utils.js";
import { resolveCaller } from "./resolve-auth-user.js";

export class UserScopeAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "UserScopeAuthError";
	}
}

export async function requireUserScope(
	ctx: GraphQLContext,
	args: { tenantId: string; userId: string },
): Promise<{ tenantId: string; userId: string }> {
	const caller = await resolveCaller(ctx);
	if (!caller.userId || !caller.tenantId) {
		throw new UserScopeAuthError("User and tenant context required");
	}
	if (caller.tenantId !== args.tenantId) {
		throw new UserScopeAuthError("Access denied: tenant mismatch");
	}
	if (caller.userId !== args.userId) {
		throw new UserScopeAuthError("Access denied: user mismatch");
	}
	return { tenantId: caller.tenantId, userId: caller.userId };
}

export async function requireMemoryUserScope(
	ctx: GraphQLContext,
	args: {
		tenantId?: string | null;
		userId?: string | null;
		agentId?: string | null;
		assistantId?: string | null;
		ownerId?: string | null;
	},
): Promise<{ tenantId: string; userId: string }> {
	const caller = await resolveCaller(ctx);
	const tenantId = args.tenantId ?? caller.tenantId ?? ctx.auth.tenantId ?? null;
	if (!tenantId) throw new UserScopeAuthError("Tenant context required");

	if (args.userId) {
		if (caller.tenantId && caller.tenantId !== tenantId) {
			throw new UserScopeAuthError("Access denied: tenant mismatch");
		}
		if (ctx.auth.authType !== "apikey" && caller.userId && caller.userId !== args.userId) {
			throw new UserScopeAuthError("Access denied: user mismatch");
		}
		if (!caller.userId && ctx.auth.authType !== "apikey") {
			throw new UserScopeAuthError("User context required");
		}
		return { tenantId, userId: args.userId };
	}

	const legacyAgentId = args.agentId ?? args.assistantId ?? args.ownerId ?? null;
	if (!legacyAgentId) {
		throw new UserScopeAuthError("User context required");
	}

	const result = await db.execute(sql`
		SELECT id, tenant_id, human_pair_id
		FROM agents
		WHERE id = ${legacyAgentId}
		  AND tenant_id = ${tenantId}
		LIMIT 1
	`);
	const [agent] = ((result as unknown as { rows?: Array<{
		id: string;
		tenant_id: string;
		human_pair_id: string | null;
	}> }).rows ?? []);

	if (!agent?.human_pair_id) {
		throw new UserScopeAuthError("Agent is not paired to a user");
	}
	if (caller.userId && caller.userId !== agent.human_pair_id) {
		throw new UserScopeAuthError("Access denied: user mismatch");
	}
	if (caller.tenantId && caller.tenantId !== tenantId) {
		throw new UserScopeAuthError("Access denied: tenant mismatch");
	}
	return { tenantId, userId: agent.human_pair_id };
}
