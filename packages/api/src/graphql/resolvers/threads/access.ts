import { sql, threads } from "../../utils.js";

/**
 * User-visible Threads are private to the requester unless the requester was
 * explicitly added as a participant via a mention/collaboration invite.
 * Tenant role and Space membership are not thread visibility grants;
 * service-secret callers bypass this at their own resolver boundary for
 * background/system work.
 */
export function callerVisibleThreadPredicate(
  tenantId: string,
  callerUserId: string,
) {
  return sql`(
    ${threads.user_id} = ${callerUserId}
    OR EXISTS (
        SELECT 1
          FROM thread_participants caller_tp
         WHERE caller_tp.tenant_id = ${tenantId}
           AND caller_tp.thread_id = ${threads.id}
           AND caller_tp.participant_type = 'user'
           AND caller_tp.user_id = ${callerUserId}
    )
  )`;
}
