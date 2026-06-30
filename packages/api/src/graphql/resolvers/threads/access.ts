import { sql, threads, workItems, workItemThreadLinks } from "../../utils.js";

/**
 * User-visible Threads are private to the requester unless the requester was
 * explicitly added as a participant via a mention/collaboration invite.
 * A user assigned a Work Item linked to the Thread can also see that Thread;
 * assignment is the task-level invite and does not create a participant row.
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
    OR EXISTS (
        SELECT 1
          FROM ${workItemThreadLinks} caller_witl
          JOIN ${workItems} caller_wi
            ON caller_wi.tenant_id = caller_witl.tenant_id
           AND caller_wi.id = caller_witl.work_item_id
         WHERE caller_witl.tenant_id = ${tenantId}
           AND caller_witl.thread_id = ${threads.id}
           AND caller_wi.owner_user_id = ${callerUserId}
           AND caller_wi.archived_at IS NULL
    )
  )`;
}
