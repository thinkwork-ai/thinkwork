import { sql, threads } from "../../utils.js";

/**
 * User-visible Threads are private to the requester unless the requester was
 * explicitly added as a participant via a mention. Tenant role is not a thread
 * visibility grant; service-secret callers bypass this at their own resolver
 * boundary for background/system work.
 */
export function callerVisibleThreadPredicate(
  tenantId: string,
  callerUserId: string,
) {
  return sql`(
    (
      ${threads.user_id} = ${callerUserId}
      OR EXISTS (
        SELECT 1
          FROM thread_participants caller_tp
         WHERE caller_tp.tenant_id = ${tenantId}
           AND caller_tp.thread_id = ${threads.id}
           AND caller_tp.participant_type = 'user'
           AND caller_tp.user_id = ${callerUserId}
      )
    )
    AND (
      ${threads.space_id} IS NULL
      OR EXISTS (
        SELECT 1
          FROM spaces caller_space
         WHERE caller_space.tenant_id = ${tenantId}
           AND caller_space.id = ${threads.space_id}
           AND caller_space.status = 'active'
           AND (
             caller_space.access_mode = 'public'
             OR EXISTS (
               SELECT 1
                 FROM space_members caller_sm
                WHERE caller_sm.tenant_id = ${tenantId}
                  AND caller_sm.space_id = caller_space.id
                  AND caller_sm.user_id = ${callerUserId}
             )
           )
      )
      -- A mention into a thread is a thread-level invite: an explicit
      -- participant sees THAT thread even inside a private Space they don't
      -- belong to. They still don't gain access to the rest of the Space —
      -- the participant clause above gates them to this thread only.
      OR EXISTS (
        SELECT 1
          FROM thread_participants caller_tp_space
         WHERE caller_tp_space.tenant_id = ${tenantId}
           AND caller_tp_space.thread_id = ${threads.id}
           AND caller_tp_space.participant_type = 'user'
           AND caller_tp_space.user_id = ${callerUserId}
      )
    )
  )`;
}
