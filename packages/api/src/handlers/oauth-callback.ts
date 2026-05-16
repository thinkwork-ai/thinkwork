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

import {
  getOAuthClientCredentials,
  isSecretsManagerProvider,
} from "../lib/oauth-client-credentials.js";
import { upsertSlackUserLink } from "../lib/slack/user-link-store.js";

const { connections, connectProviders, credentials, agentSkills } = schema;

const STAGE = process.env.STAGE || "dev";
const OAUTH_CALLBACK_URL = process.env.OAUTH_CALLBACK_URL || "";
const REDIRECT_SUCCESS_URL =
  process.env.REDIRECT_SUCCESS_URL ||
  "https://app.thinkwork.ai/settings/credentials";

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
  ok?: boolean;
  access_token?: string;
  refresh_token?: string;
  expires_in?: number;
  token_type?: string;
  scope?: string;
  authed_user?: {
    id?: string;
    access_token?: string;
    scope?: string;
    token_type?: string;
  };
  team?: {
    id?: string;
    name?: string;
  };
  error?: string;
}

interface SlackIdentityResponse {
  ok?: boolean;
  user?: {
    id?: string;
    name?: string;
    email?: string;
  };
  team?: {
    id?: string;
    name?: string;
  };
  error?: string;
}

export async function handler(
  event: APIGatewayProxyEventV2,
): Promise<APIGatewayProxyStructuredResultV2> {
  const params = event.queryStringParameters || {};
  const code = params.code;
  const state = params.state;
  const errorParam = params.error;

  if (errorParam) {
    console.error(
      `[oauth-callback] Provider returned error: ${errorParam} - ${params.error_description}`,
    );
    return redirect(
      `${REDIRECT_SUCCESS_URL}?status=error&reason=${encodeURIComponent(errorParam)}`,
    );
  }

  if (!code || !state) {
    return redirect(
      `${REDIRECT_SUCCESS_URL}?status=error&reason=missing_params`,
    );
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
      (c: (typeof allPending)[number]) =>
        (c.metadata as Record<string, unknown>)?.oauth_state === state,
    );

    if (!conn) {
      console.error(
        `[oauth-callback] No pending connection found for state: ${state.slice(0, 8)}...`,
      );
      return redirect(
        `${REDIRECT_SUCCESS_URL}?status=error&reason=invalid_state`,
      );
    }

    // 2. Look up provider
    const [provider] = await db
      .select()
      .from(connectProviders)
      .where(eq(connectProviders.id, conn.provider_id));

    if (!provider) {
      return redirectForConn(conn, "error", "reason=provider_not_found");
    }

    const config = provider.config as ProviderConfig;

    // Determine client credentials — managed OAuth providers use Secrets Manager.
    let clientId = "";
    let clientSecret = "";
    if (isSecretsManagerProvider(provider.name)) {
      try {
        const creds = await getOAuthClientCredentials(provider.name);
        clientId = creds.clientId;
        clientSecret = creds.clientSecret;
      } catch (credErr) {
        console.error(
          `[oauth-callback] Secret fetch failed for ${provider.name}:`,
          credErr,
        );
        return redirectForConn(conn, "error", "reason=client_creds_missing");
      }
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
      console.error(
        `[oauth-callback] Token exchange failed: ${tokenRes.status} ${errText}`,
      );
      return redirectForConn(conn, "error", "reason=token_exchange_failed");
    }

    const tokens = (await tokenRes.json()) as TokenResponse;
    if (provider.name === "slack" && tokens.ok === false) {
      console.error(
        `[oauth-callback] Slack token exchange failed: ${tokens.error || "unknown_error"}`,
      );
      return redirectForConn(conn, "error", "reason=token_exchange_failed");
    }
    console.log(
      `[oauth-callback] Token exchange succeeded for connection ${conn.id}`,
    );

    const accessToken =
      provider.name === "slack"
        ? tokens.authed_user?.access_token || tokens.access_token || ""
        : tokens.access_token || "";
    if (!accessToken) {
      console.error(
        `[oauth-callback] Token exchange for ${provider.name} did not return an access token`,
      );
      return redirectForConn(conn, "error", "reason=missing_access_token");
    }

    // 4. Get user info (email + native user id) from provider.
    // Native user id is load-bearing for webhook ingestion: provider
    // webhooks carry the native id, not email, and we need to route an
    // inbound event back to the connected user.
    let externalId = "";
    let providerUserinfo: Record<string, unknown> = {};
    try {
      const userinfoRes = await fetch(config.userinfo_url, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (userinfoRes.ok) {
        providerUserinfo = (await userinfoRes.json()) as Record<
          string,
          unknown
        >;
        if (provider.name === "slack") {
          const slackIdentity = providerUserinfo as SlackIdentityResponse;
          if (slackIdentity.ok === false) {
            console.error(
              `[oauth-callback] Slack users.identity failed: ${slackIdentity.error || "unknown_error"}`,
            );
            return redirectForConn(conn, "error", "reason=userinfo_failed");
          }
          externalId = slackIdentity.user?.id || tokens.authed_user?.id || "";
        } else {
          externalId =
            (providerUserinfo.email as string | undefined) ||
            (providerUserinfo.mail as string | undefined) ||
            (providerUserinfo.userPrincipalName as string | undefined) ||
            "";
        }
      }
    } catch (err) {
      console.warn(`[oauth-callback] Userinfo fetch failed:`, err);
    }

    let slackLinkId: string | null = null;
    let slackTeamId: string | null = null;
    if (provider.name === "slack") {
      const slackIdentity = providerUserinfo as SlackIdentityResponse;
      slackTeamId = slackIdentity.team?.id || tokens.team?.id || null;
      const slackUserId =
        slackIdentity.user?.id || tokens.authed_user?.id || "";
      if (!slackTeamId || !slackUserId) {
        console.error(
          `[oauth-callback] Slack identity response missing team/user id`,
        );
        return redirectForConn(conn, "error", "reason=missing_slack_identity");
      }
      try {
        const linked = await upsertSlackUserLink({
          tenantId: conn.tenant_id,
          userId: conn.user_id,
          slackTeamId,
          slackTeamName: slackIdentity.team?.name || tokens.team?.name || null,
          slackUserId,
          slackUserName: slackIdentity.user?.name || null,
          slackUserEmail: slackIdentity.user?.email || null,
        });
        slackLinkId = linked.id;
      } catch (linkErr) {
        console.error(`[oauth-callback] Slack identity link failed:`, linkErr);
        return redirectForConn(conn, "error", "reason=slack_link_failed");
      }
    }

    // 5. Store tokens in Secrets Manager
    const secretId = `thinkwork/${STAGE}/oauth/${conn.id}`;
    const secretValue = JSON.stringify({
      access_token: accessToken,
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
      ...((conn.metadata as Record<string, unknown>) || {}),
      oauth_state: undefined, // Clear state token
    };
    delete metadata.oauth_state;

    if (provider.name === "google_productivity") {
      // Initialize Gmail historyId
      try {
        const profileRes = await fetch(
          "https://gmail.googleapis.com/gmail/v1/users/me/profile",
          { headers: { Authorization: `Bearer ${tokens.access_token}` } },
        );
        if (profileRes.ok) {
          const profile = (await profileRes.json()) as { historyId?: string };
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

    if (provider.name === "slack") {
      metadata.slack_team_id = slackTeamId;
      metadata.slack_user_link_id = slackLinkId;
      metadata.slack_authed_user_id =
        (providerUserinfo as SlackIdentityResponse).user?.id ||
        tokens.authed_user?.id ||
        null;
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

    console.log(
      `[oauth-callback] Connection ${conn.id} activated, external_id=${externalId}`,
    );

    // 9. If agentId/skillId were passed, auto-link connection to agent_skill
    const connMeta = (conn.metadata as Record<string, unknown>) || {};
    const agentId = connMeta.agent_id as string | undefined;
    const skillId = connMeta.skill_id as string | undefined;

    if (agentId && skillId) {
      try {
        // Determine the token env var name based on skill
        const tokenEnvVar =
          skillId === "google-email"
            ? "GMAIL_ACCESS_TOKEN"
            : skillId === "google-calendar"
              ? "GCAL_ACCESS_TOKEN"
              : skillId === "microsoft-email"
                ? "MSGRAPH_ACCESS_TOKEN"
                : skillId === "microsoft-calendar"
                  ? "MSCAL_ACCESS_TOKEN"
                  : "ACCESS_TOKEN";
        const connectionIdVar =
          skillId === "google-email"
            ? "GMAIL_CONNECTION_ID"
            : skillId === "google-calendar"
              ? "GCAL_CONNECTION_ID"
              : skillId === "microsoft-email"
                ? "MSGRAPH_CONNECTION_ID"
                : skillId === "microsoft-calendar"
                  ? "MSCAL_CONNECTION_ID"
                  : `${skillId.toUpperCase().replace(/-/g, "_")}_CONNECTION_ID`;

        // Upsert agent_skill — insert if missing, update config if exists
        const skillConfig: Record<string, unknown> = {
          connectionId: conn.id,
          tokenEnvVar,
          connectionIdVar,
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
          const existingConfig =
            (existingSkill.config as Record<string, unknown>) || {};
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

        console.log(
          `[oauth-callback] Linked connection ${conn.id} to agent_skill ${agentId}/${skillId}`,
        );
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

    return redirectForConn(
      conn,
      "connected",
      `provider=${encodeURIComponent(provider.name)}`,
    );
  } catch (err) {
    console.error(`[oauth-callback] Unexpected error:`, err);
    return redirect(
      `${REDIRECT_SUCCESS_URL}?status=error&reason=internal_error`,
    );
  }
}

function redirect(url: string): APIGatewayProxyStructuredResultV2 {
  return {
    statusCode: 302,
    headers: { Location: url },
    body: "",
  };
}

/**
 * Redirect to the per-request `return_url` captured in the pending-connection
 * metadata (set by oauth-authorize.ts:140 from the mobile/admin caller),
 * falling back to `REDIRECT_SUCCESS_URL` for web callers that didn't supply one.
 *
 * Mobile passes a custom scheme (e.g. `thinkwork://settings/integrations`) so
 * `openAuthSessionAsync` can close the in-app browser and hand control back.
 */
function redirectForConn(
  conn: { metadata?: unknown } | null | undefined,
  status: "connected" | "error",
  queryTail: string,
): APIGatewayProxyStructuredResultV2 {
  const meta = (conn?.metadata as Record<string, unknown> | undefined) || {};
  const returnUrl =
    typeof meta.return_url === "string" && meta.return_url
      ? meta.return_url
      : REDIRECT_SUCCESS_URL;
  const separator = returnUrl.includes("?") ? "&" : "?";
  return redirect(`${returnUrl}${separator}status=${status}&${queryTail}`);
}
