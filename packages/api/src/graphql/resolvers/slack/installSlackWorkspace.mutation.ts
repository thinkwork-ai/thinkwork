import type { GraphQLContext } from "../../context.js";
import { getSlackAppCredentials } from "../../../lib/slack/workspace-store.js";
import {
  buildSlackAuthorizeUrl,
  createSlackInstallState,
  sanitizeSlackInstallReturnUrl,
  slackOAuthRedirectUri,
} from "../../../lib/slack/oauth-state.js";
import { requireTenantAdmin } from "../core/authz.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

interface StartSlackWorkspaceInstallArgs {
  input: {
    tenantId: string;
    returnUrl?: string | null;
    redirectUri?: string | null;
  };
}

export async function startSlackWorkspaceInstall(
  _parent: unknown,
  args: StartSlackWorkspaceInstallArgs,
  ctx: GraphQLContext,
): Promise<{ authorizeUrl: string; state: string; expiresAt: string }> {
  const tenantId = args.input.tenantId;
  await requireTenantAdmin(ctx, tenantId);
  const adminUserId = await resolveCallerUserId(ctx);
  if (!adminUserId) {
    throw new Error("Slack install requires an authenticated admin user");
  }

  const credentials = await getSlackAppCredentials();
  const returnUrl = sanitizeSlackInstallReturnUrl(args.input.returnUrl);
  const redirectUri = args.input.redirectUri?.trim() || slackOAuthRedirectUri();
  const state = createSlackInstallState({
    tenantId,
    adminUserId,
    clientSecret: credentials.clientSecret,
    returnUrl,
  });

  const payload = JSON.parse(
    Buffer.from(state.split(".")[0] ?? "", "base64url").toString("utf8"),
  ) as { expiresAt: number };

  return {
    authorizeUrl: buildSlackAuthorizeUrl({
      clientId: credentials.clientId,
      redirectUri,
      state,
    }),
    state,
    expiresAt: new Date(payload.expiresAt).toISOString(),
  };
}
