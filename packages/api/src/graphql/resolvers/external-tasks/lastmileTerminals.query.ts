/**
 * lastmileTerminals — server-side query that the LastMile-tasks skill
 * (or the admin/mobile clients) invokes to enumerate the current user's
 * terminals without the caller having to touch the PAT directly.
 *
 * Auth: takes the `threadId` the agent/user is acting on and resolves
 * the thread's creator to pick the LastMile connection — mirrors the
 * inbox-approval path so terminals listed here are exactly the ones
 * the eventual `POST /tasks` would accept.
 */

import type { GraphQLContext } from "../../context.js";
import { getOrMintLastmilePat, forceRefreshLastmilePat } from "../../../lib/lastmile-pat.js";
import {
	resolveOAuthToken,
	forceRefreshLastmileUserToken,
} from "../../../lib/oauth-token.js";
import { getConnectorBaseUrl } from "../../../handlers/task-connectors.js";
import {
	listTerminals,
	isLastmileRestConfigured,
} from "../../../integrations/external-work-items/providers/lastmile/restClient.js";
import {
	findActiveTaskConnection,
} from "../../../integrations/external-work-items/syncExternalTaskOnCreate.js";
import { resolveThreadCreator } from "../../../integrations/external-work-items/createLastmileTaskForInboxApproval.js";

export const lastmileTerminals = async (
	_parent: unknown,
	args: { threadId: string },
	_ctx: GraphQLContext,
) => {
	const creator = await resolveThreadCreator(args.threadId);
	if (!creator) throw new Error(`Thread ${args.threadId} not found`);

	const baseUrl = await getConnectorBaseUrl(creator.tenantId, "lastmile");
	if (!isLastmileRestConfigured({ baseUrl })) {
		throw new Error(
			"LastMile base URL not configured for this tenant — set it on Connectors → LastMile.",
		);
	}

	const conn = await findActiveTaskConnection(creator.tenantId, creator.userId);
	if (!conn) throw new Error("No active LastMile task connector for this user.");

	const authToken = await getOrMintLastmilePat({
		userId: creator.userId,
		getFreshWorkosJwt: () =>
			resolveOAuthToken(conn.id, creator.tenantId, conn.provider_id),
	});
	if (!authToken) {
		throw new Error(
			`Task connector ${conn.provider_name} has no usable LastMile token — reconnect in Connectors.`,
		);
	}

	const terminals = await listTerminals({
		ctx: {
			authToken,
			baseUrl,
			refreshToken: () =>
				forceRefreshLastmilePat({
					userId: creator.userId,
					getFreshWorkosJwt: () =>
						forceRefreshLastmileUserToken(conn.id, creator.tenantId),
				}),
		},
	});

	// Slim down the payload to what an agent needs for disambiguation.
	// The REST envelope carries nested terminalProducts/ServiceAreas that
	// would bloat the tool response without helping terminal selection.
	return terminals.map((t) => ({
		id: t.id,
		name: t.name,
		externalId: t.externalId ?? null,
		abbv: t.abbv ?? null,
		city: t.location?.city ?? null,
		state: t.location?.state ?? null,
	}));
};
