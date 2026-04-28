import type { AuthResult } from "../cognito-auth.js";
import { resolveCallerFromAuth } from "../../graphql/resolvers/core/resolve-auth-user.js";
import { and, db, eq, tenantMembers } from "../../graphql/utils.js";
import type { ContextEngineCaller } from "./types.js";

export async function resolveContextEngineCallerFromAuth(args: {
	auth: AuthResult;
	agentId?: string | null;
	templateId?: string | null;
	traceId?: string | null;
}): Promise<ContextEngineCaller | null> {
	const resolved = await resolveCallerFromAuth(args.auth);
	const tenantId = args.auth.tenantId ?? resolved.tenantId;
	const userId = resolved.userId;
	if (!tenantId) return null;
	if (userId && !(await userBelongsToTenant(tenantId, userId))) return null;
	return {
		tenantId,
		userId,
		agentId: args.agentId ?? args.auth.agentId ?? null,
		templateId: args.templateId ?? null,
		traceId: args.traceId ?? null,
	};
}

export async function validateContextEngineCaller(
	caller: ContextEngineCaller,
): Promise<boolean> {
	if (!caller.tenantId) return false;
	if (!caller.userId) return true;
	return await userBelongsToTenant(caller.tenantId, caller.userId);
}

async function userBelongsToTenant(
	tenantId: string,
	userId: string,
): Promise<boolean> {
	const rows = await db
		.select({ id: tenantMembers.id })
		.from(tenantMembers)
		.where(
			and(
				eq(tenantMembers.tenant_id, tenantId),
				eq(tenantMembers.principal_type, "user"),
				eq(tenantMembers.principal_id, userId),
			),
		)
		.limit(1);
	return rows.length > 0;
}
