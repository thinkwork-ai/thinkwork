/**
 * Personal email self-service authorization (THINK-193 U6).
 *
 * A user may configure/grant THEIR OWN mailbox on THEIR OWN personal
 * memory processor — nothing else. Every check fails closed:
 *   - the caller must be a signed-in user;
 *   - the caller must OWN the personal processor (created_by_user_id AND
 *     target_id — a personal processor targets exactly its owner's User
 *     Bank, so both must match);
 *   - the family must be 'email' (the only personal-capable family);
 *   - the binding key must be an ACTIVE google_productivity connection
 *     the caller owns (connection ownership is proven, never assumed).
 *
 * Shared processors never take this path — shared email grants/configs
 * remain tenant-admin gated (R9: connection ownership alone never
 * authorizes company memory).
 */

import type { GraphQLContext } from "../../context.js";
import { resolveConnectionForUserById } from "../../../lib/oauth-token.js";
import { resolveCallerUserId } from "../core/resolve-auth-user.js";

const EMAIL_CONNECTION_PROVIDER = "google_productivity";

export async function assertPersonalEmailSelfService(
  ctx: GraphQLContext,
  args: {
    tenantId: string;
    processor: {
      id: string;
      mode: string;
      target_scope: string;
      target_id: string;
      created_by_user_id: string | null;
    };
    sourceFamily: string;
    sourceBindingKey: string;
  },
): Promise<{ callerUserId: string }> {
  const { processor } = args;
  if (processor.mode !== "personal") {
    throw new Error(
      "Self-service source management applies to personal processors only",
    );
  }
  const callerUserId = await resolveCallerUserId(ctx);
  if (!callerUserId) {
    throw new Error(
      "A signed-in user is required — personal memory sources belong to a user, not a service caller",
    );
  }
  if (
    processor.created_by_user_id !== callerUserId ||
    processor.target_scope !== "user" ||
    processor.target_id !== callerUserId
  ) {
    throw new Error(
      "Only the owner of a personal memory processor may manage its sources",
    );
  }
  if (args.sourceFamily !== "email") {
    throw new Error(
      `Source family "${args.sourceFamily}" is not self-serviceable — personal processors currently support only 'email'`,
    );
  }
  const connection = await resolveConnectionForUserById({
    tenantId: args.tenantId,
    userId: callerUserId,
    providerName: EMAIL_CONNECTION_PROVIDER,
    connectionId: args.sourceBindingKey,
  });
  if (!connection) {
    throw new Error(
      "sourceBindingKey must be an ACTIVE Google connection you own — connect Google in Settings → Integrations first",
    );
  }
  return { callerUserId };
}
