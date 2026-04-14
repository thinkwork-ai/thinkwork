/**
 * OAuth Callback Handler
 *
 * GET /api/oauth/callback?code=...&state=...
 *
 * 1. Find pending connection by oauth_state
 * 2. Exchange code for tokens via provider's token_url
 * 3. Store tokens in Secrets Manager at thinkwork/{stage}/oauth/{connection_id}
 * 4. Create credentials row with secretRef + expires_at
 * 5. Transition connection to active, set external_id (email), init sync cursors
 * 6. Redirect to app.thinkwork.ai/settings/integrations
 */

import type {
	APIGatewayProxyEventV2,
	APIGatewayProxyStructuredResultV2,
} from "aws-lambda";
import { eq, and } from "drizzle-orm";
import { schema } from "@thinkwork/database-pg";
import { db } from "../lib/db.js";
import {
	SecretsManagerClient,
	CreateSecretCommand,
	UpdateSecretCommand,
	ResourceNotFoundException,
} from "@aws-sdk/client-secrets-manager";

const { connections, connectProviders, credentials, agentSkills } = schema;

const STAGE = process.env.STAGE || "dev";
const GOOGLE_CLIENT_ID = process.env.GOOGLE_PRODUCTIVITY_CLIENT_ID || "";
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_PRODUCTIVITY_CLIENT_SECRET || "";
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CLIENT_ID || "";
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CLIENT_SECRET || "";
const LASTMILE_CLIENT_ID = process.env.LASTMILE_CLIENT_ID || "";
const LASTMILE_CLIENT_SECRET = process.env.LASTMILE_CLIENT_SECRET || "";
const OAUTH_CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || "";
const REDIRECT_SUCCESS_URL = process.env.REDIRECT_SUCCESS_URL || "https://app.thinkwork.ai/settings/integrations";

const sm = new SecretsManagerClient({
	region: process.env.AWS_REGION || "us-east-1",
});

interface ProviderConfig {
	authorization_url: string;
	token_url: string;
	userinfo_url: string;
	scopes: Record<string, string>;
	extra_params?: Record<string, string>;
}

interface TokenResponse {
	access_token: string;
	refresh_token?: string;
	expires_in?: number;
	token_type?: string;
	scope?: string;
}

export async function handler(
	event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
	const params = event.queryStringParameters || {};
	const code = params.code;
	const state = params.state;
	const errorParam = params.error;

	if (errorParam) {
		console.error(`[oauth-callback] Provider returned error: ${errorParam} - ${params.error_description}`);
		return redirect(`${REDIRECT_SUCCESS_URL}?status=error&reason=${encodeURIComponent(errorParam)}`);
	}

	if (!code || !state) {
		return redirect(`${REDIRECT_SUCCESS_URL}?status=error&reason=missing_params`);
	}

	try {
		// 1. Find pending connection by state
		const allPending = await db
			.select({
				id: connections.id,
				tenant_id: connections.tenant_id,
				user_id: connections.user_id,
				provider_id: connections.provider_id,
				metadata: connections.metadata,
			})
			.from(connections)
			.where(eq(connections.status, "pending"));

		const conn = allPending.find(
			(c: typeof allPending[number]) => (c.metadata as Record<string, unknown>)?.oauth_state === state,
		);

		if (!conn) {
			console.error(`[oauth-callback] No pending connection found for state: ${state.slice(0, 8)}...`);
			return redirect(`${REDIRECT_SUCCESS_URL}?status=error&reason=invalid_state`);
		}

		// 2. Look up provider
		const [provider] = await db
			.select()
			.from(connectProviders)
			.where(eq(connectProviders.id, conn.provider_id));

		if (!provider) {
			return redirect(`${REDIRECT_SUCCESS_URL}?status=error&reason=provider_not_found`);
		}

		const config = provider.config as ProviderConfig;

		// Determine client credentials
		let clientId = "";
		let clientSecret = "";
		if (provider.name === "google_productivity") {
			clientId = GOOGLE_CLIENT_ID;
			clientSecret = GOOGLE_CLIENT_SECRET;
		} else if (provider.name === "microsoft_365") {
			clientId = MICROSOFT_CLIENT_ID;
			clientSecret = MICROSOFT_CLIENT_SECRET;
		} else if (provider.name === "lastmile") {
			clientId = LASTMILE_CLIENT_ID;
			clientSecret = LASTMILE_CLIENT_SECRET;
		}

		// 3. Exchange code for tokens
		const tokenBody = new URLSearchParams({
			grant_type: "authorization_code",
			code,
			redirect_uri: OAUTH_CALLBACK_URL,
			client_id: clientId,
			client_secret: clientSecret,
		});

		const tokenRes = await fetch(config.token_url, {
			method: "POST",
			headers: { "Content-Type": "application/x-www-form-urlencoded" },
			body: tokenBody.toString(),
		});

		if (!tokenRes.ok) {
			const errText = await tokenRes.text();
			console.error(`[oauth-callback] Token exchange failed: ${tokenRes.status} ${errText}`);
			return redirect(`${REDIRECT_SUCCESS_URL}?status=error&reason=token_exchange_failed`);
		}

		const tokens = await tokenRes.json() as TokenResponse;
		console.log(`[oauth-callback] Token exchange succeeded for connection ${conn.id}`);

		// 4. Get user info (email + native user id) from provider.
		// Native user id is load-bearing for webhook ingestion: provider
		// webhooks carry the native id, not email, and we need to route an
		// inbound event back to the connected user.
		let externalId = "";
		let providerUserinfo: Record<string, unknown> = {};
		try {
			const userinfoRes = await fetch(config.userinfo_url, {
				headers: { Authorization: `Bearer ${tokens.access_token}` },
			});
			if (userinfoRes.ok) {
				providerUserinfo = (await userinfoRes.json()) as Record<string, unknown>;
				externalId =
					(providerUserinfo.email as string | undefined) ||
					(providerUserinfo.mail as string | undefined) ||
					(providerUserinfo.userPrincipalName as string | undefined) ||
					"";
			}
		} catch (err) {
			console.warn(`[oauth-callback] Userinfo fetch failed:`, err);
		}

		// 5. Store tokens in Secrets Manager
		const secretId = `thinkwork/${STAGE}/oauth/${conn.id}`;
		const secretValue = JSON.stringify({
			access_token: tokens.access_token,
			refresh_token: tokens.refresh_token || "",
			token_type: tokens.token_type || "Bearer",
			scope: tokens.scope || "",
			obtained_at: new Date().toISOString(),
		});

		try {
			await sm.send(
				new UpdateSecretCommand({
					SecretId: secretId,
					SecretString: secretValue,
				}),
			);
		} catch (err) {
			if (err instanceof ResourceNotFoundException) {
				await sm.send(
					new CreateSecretCommand({
						Name: secretId,
						SecretString: secretValue,
					}),
				);
			} else {
				throw err;
			}
		}

		// 6. Create credentials row
		const expiresAt = tokens.expires_in
			? new Date(Date.now() + tokens.expires_in * 1000)
			: null;

		await db.insert(credentials).values({
			connection_id: conn.id,
			tenant_id: conn.tenant_id,
			credential_type: "oauth2",
			encrypted_value: secretId, // secretRef pointing to Secrets Manager
			expires_at: expiresAt,
		});

		// 7. Initialize sync cursors based on provider
		const metadata: Record<string, unknown> = {
			...(conn.metadata as Record<string, unknown> || {}),
			oauth_state: undefined, // Clear state token
		};
		delete metadata.oauth_state;

		// LastMile: persist the provider-native user id under
		// `metadata.lastmile.userId` so inbound webhooks can route events back
		// to this connection (webhooks carry the native id, not email).
		if (provider.name === "lastmile") {
			const lastmileUserId =
				(providerUserinfo.id as string | undefined) ||
				(providerUserinfo.user_id as string | undefined) ||
				(providerUserinfo.userId as string | undefined) ||
				(providerUserinfo.sub as string | undefined);
			const existingLastmileMeta = (metadata.lastmile as Record<string, unknown> | undefined) ?? {};
			metadata.lastmile = {
				...existingLastmileMeta,
				...(lastmileUserId ? { userId: lastmileUserId } : {}),
				...(providerUserinfo.name ? { name: providerUserinfo.name } : {}),
			};
			if (!lastmileUserId) {
				console.warn(
					`[oauth-callback] LastMile userinfo missing native user id — webhook ingestion will fail for connection ${conn.id}`,
				);
			}
		}

		if (provider.name === "google_productivity") {
			// Initialize Gmail historyId
			try {
				const profileRes = await fetch(
					"https://gmail.googleapis.com/gmail/v1/users/me/profile",
					{ headers: { Authorization: `Bearer ${tokens.access_token}` } },
				);
				if (profileRes.ok) {
					const profile = await profileRes.json() as { historyId?: string };
					metadata.gmail_history_id = profile.historyId || null;
					metadata.gmail_last_sync_at = new Date().toISOString();
				}
			} catch (err) {
				console.warn(`[oauth-callback] Gmail profile fetch failed:`, err);
			}

			// Calendar syncToken starts null — first sync uses full list
			metadata.gcal_sync_token = null;
			metadata.gcal_last_sync_at = null;
		}

		if (provider.name === "microsoft_365") {
			// Initialize delta tokens — null means first sync uses full list
			metadata.graph_mail_delta_link = null;
			metadata.graph_mail_last_sync_at = null;
			metadata.graph_cal_delta_link = null;
			metadata.graph_cal_last_sync_at = null;
		}

		// 8. Transition connection to active
		await db
			.update(connections)
			.set({
				status: "active",
				external_id: externalId || null,
				connected_at: new Date(),
				metadata,
				updated_at: new Date(),
			})
			.where(eq(connections.id, conn.id));

		console.log(`[oauth-callback] Connection ${conn.id} activated, external_id=${externalId}`);

		// 9. If agentId/skillId were passed, auto-link connection to agent_skill
		const connMeta = (conn.metadata as Record<string, unknown>) || {};
		const agentId = connMeta.agent_id as string | undefined;
		const skillId = connMeta.skill_id as string | undefined;

		if (agentId && skillId) {
			try {
				// Determine the token env var name based on skill
				const tokenEnvVar = skillId === "google-email" ? "GMAIL_ACCESS_TOKEN"
					: skillId === "google-calendar" ? "GCAL_ACCESS_TOKEN"
					: skillId === "microsoft-email" ? "MSGRAPH_ACCESS_TOKEN"
					: skillId === "microsoft-calendar" ? "MSCAL_ACCESS_TOKEN"
					: skillId === "lastmile-crm" || skillId === "lastmile-tasks" ? "LASTMILE_ACCESS_TOKEN"
					: "ACCESS_TOKEN";
				const connectionIdVar = skillId === "google-email" ? "GMAIL_CONNECTION_ID"
					: skillId === "google-calendar" ? "GCAL_CONNECTION_ID"
					: skillId === "microsoft-email" ? "MSGRAPH_CONNECTION_ID"
					: skillId === "microsoft-calendar" ? "MSCAL_CONNECTION_ID"
					: skillId === "lastmile-crm" || skillId === "lastmile-tasks" ? "LASTMILE_CONNECTION_ID"
					: `${skillId.toUpperCase().replace(/-/g, "_")}_CONNECTION_ID`;

				// Determine mcpServer for skills that use MCP routing
				const mcpServer = skillId.startsWith("lastmile-") ? skillId : undefined;

				// Upsert agent_skill — insert if missing, update config if exists
				const skillConfig: Record<string, unknown> = {
					connectionId: conn.id,
					tokenEnvVar,
					connectionIdVar,
					...(mcpServer ? { mcpServer } : {}),
				};

				const [existingSkill] = await db
					.select({ id: agentSkills.id, config: agentSkills.config })
					.from(agentSkills)
					.where(
						and(
							eq(agentSkills.agent_id, agentId),
							eq(agentSkills.skill_id, skillId),
						),
					);

				if (existingSkill) {
					const existingConfig = (existingSkill.config as Record<string, unknown>) || {};
					await db
						.update(agentSkills)
						.set({
							config: { ...existingConfig, ...skillConfig },
						})
						.where(eq(agentSkills.id, existingSkill.id));
				} else {
					// Skill wasn't pre-added — create the agent_skill row
					await db.insert(agentSkills).values({
						agent_id: agentId,
						tenant_id: conn.tenant_id,
						skill_id: skillId,
						config: skillConfig,
						enabled: true,
					});
				}

				console.log(`[oauth-callback] Linked connection ${conn.id} to agent_skill ${agentId}/${skillId}`);
			} catch (linkErr) {
				console.error(`[oauth-callback] Failed to link agent_skill:`, linkErr);
				// Non-fatal — connection is still active
			}
		}

		// If opened as popup (skill install flow), return HTML that posts message to opener
		if (agentId && skillId) {
			return {
				statusCode: 200,
				headers: { "Content-Type": "text/html" },
				body: `<!DOCTYPE html><html><body><script>
					window.opener?.postMessage({ type: "oauth_complete", provider: "${provider.name}", connectionId: "${conn.id}", skillId: "${skillId}" }, "*");
					window.close();
				</script><p>Connected! You can close this window.</p></body></html>`,
			};
		}

		return redirect(`${REDIRECT_SUCCESS_URL}?status=connected&provider=${provider.name}`);
	} catch (err) {
		console.error(`[oauth-callback] Unexpected error:`, err);
		return redirect(`${REDIRECT_SUCCESS_URL}?status=error&reason=internal_error`);
	}
}

function redirect(url: string): APIGatewayProxyStructuredResultV2 {
	return {
		statusCode: 302,
		headers: { Location: url },
		body: "",
	};
}
