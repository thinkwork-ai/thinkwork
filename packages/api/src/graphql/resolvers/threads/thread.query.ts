import type { GraphQLContext } from "../../context.js";
import {
  db,
  eq,
  and,
  threads,
  threadAttachments,
  snakeToCamel,
  threadToCamel,
} from "../../utils.js";
import {
  resolveCallerTenantId,
  resolveCallerUserId,
} from "../core/resolve-auth-user.js";
import { requireTenantAdmin } from "../core/authz.js";
import { GraphQLError } from "graphql";

/**
 * Single-thread query. Tenant-pinned end-to-end so a Cognito caller in
 * tenant A cannot read tenant B's thread (or its attachments) by guessing
 * a thread UUID.
 *
 * - Cognito callers: resolve the caller's authoritative tenant (Google-
 *   federated users have `ctx.auth.tenantId === null` until the pre-token
 *   trigger lands, so we use the email-fallback lookup in
 *   `resolveCallerTenantId`). The outer `threads` query filters by
 *   `tenant_id`; the nested `thread_attachments` query also filters by
 *   `tenant_id` as defense-in-depth. Cross-tenant or unresolvable callers
 *   get `null` — identical shape to "thread not found", no enumeration
 *   oracle.
 * - apikey callers (service-to-service): pre-authorized infrastructure
 *   that may legitimately read across tenants, matching the same bypass
 *   established in `threads.query.ts`.
 */
export const thread = async (
  _parent: unknown,
  args: { id: string },
  ctx: GraphQLContext,
) => {
  let callerTenantId: string | null = null;
  let callerUserId: string | null = null;
  let isTenantAdminCaller = ctx.auth.authType === "apikey";
  if (ctx.auth.authType === "cognito") {
    callerTenantId = await resolveCallerTenantId(ctx);
    if (!callerTenantId) return null;
    callerUserId = await resolveCallerUserId(ctx);
    if (!callerUserId) return null;
  }

  const threadConditions = callerTenantId
    ? and(eq(threads.id, args.id), eq(threads.tenant_id, callerTenantId))
    : eq(threads.id, args.id);

  const [row] = await db.select().from(threads).where(threadConditions);
  if (!row) return null;
  if (ctx.auth.authType === "cognito") {
    try {
      await requireTenantAdmin(ctx, row.tenant_id);
      isTenantAdminCaller = true;
    } catch (err) {
      if (!(err instanceof GraphQLError)) throw err;
      isTenantAdminCaller = false;
    }
    if (!isTenantAdminCaller && row.user_id !== callerUserId) return null;
  }

  const attachmentConditions = callerTenantId
    ? and(
        eq(threadAttachments.thread_id, args.id),
        eq(threadAttachments.tenant_id, callerTenantId),
      )
    : eq(threadAttachments.thread_id, args.id);

  const attachmentRows = await db
    .select()
    .from(threadAttachments)
    .where(attachmentConditions);

  // Strip s3_key before snakeToCamel so the resolver return shape mirrors the
  // post-removal GraphQL `ThreadAttachment` type even in memory. Yoga already
  // drops the undeclared field at serialize time; this is defense-in-depth
  // against a future accidental re-add of `s3Key` to the schema silently
  // leaking real S3 paths through this resolver without any code change.
  return {
    ...threadToCamel(row),
    attachments: attachmentRows.map(({ s3_key: _s3Key, ...rest }) =>
      snakeToCamel(rest),
    ),
  };
};
