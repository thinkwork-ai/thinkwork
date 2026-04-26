import type { GraphQLContext } from "../../context.js";
import {
	requireMemoryUserScope,
	UserScopeAuthError,
} from "../core/require-user-scope.js";

export class WikiAuthError extends Error {
	constructor(message: string) {
		super(message);
		this.name = "WikiAuthError";
	}
}

export async function assertCanReadWikiScope(
	ctx: GraphQLContext,
	args: { tenantId?: string | null; userId?: string | null; ownerId?: string | null },
): Promise<{ tenantId: string; userId: string }> {
	try {
		return await requireMemoryUserScope(ctx, args);
	} catch (err) {
		if (err instanceof UserScopeAuthError) {
			throw new WikiAuthError(err.message);
		}
		throw err;
	}
}

export async function assertCanAdminWikiScope(
	ctx: GraphQLContext,
	args: { tenantId?: string | null; userId?: string | null; ownerId?: string | null },
): Promise<{ tenantId: string; userId: string }> {
	if (ctx.auth.authType !== "apikey") {
		throw new WikiAuthError("Admin-only: requires internal API key credential");
	}
	return assertCanReadWikiScope(ctx, args);
}
