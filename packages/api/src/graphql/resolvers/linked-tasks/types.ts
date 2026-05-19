import { and, asc, db, eq, linkedTaskEvents } from "../../utils.js";
import { toGraphqlLinkedTaskEvent } from "./shared.js";

export const linkedTaskTypeResolvers = {
  events: async (parent: any) => {
    const linkedTaskId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(linkedTaskEvents)
      .where(
        and(
          eq(linkedTaskEvents.tenant_id, tenantId),
          eq(linkedTaskEvents.linked_task_id, linkedTaskId),
        ),
      )
      .orderBy(asc(linkedTaskEvents.occurred_at));
    return rows.map((row) => toGraphqlLinkedTaskEvent(row));
  },
};
