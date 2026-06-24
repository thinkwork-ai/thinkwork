import {
  and,
  asc,
  db,
  eq,
  workItemEvents,
  workItemExternalRefs,
  workItemStatuses,
  workItemThreadLinks,
} from "../../utils.js";
import {
  toGraphqlWorkItemEvent,
  toGraphqlWorkItemExternalRef,
  toGraphqlWorkItemStatus,
  toGraphqlWorkItemThreadLink,
} from "./shared.js";

export const workItemTypeResolvers = {
  status: async (parent: any) => {
    const statusId = parent.statusId ?? parent.status_id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    if (!statusId) return null;
    const [status] = await db
      .select()
      .from(workItemStatuses)
      .where(
        and(
          eq(workItemStatuses.tenant_id, tenantId),
          eq(workItemStatuses.id, statusId),
        ),
      );
    return status ? toGraphqlWorkItemStatus(status) : null;
  },
  threadLinks: async (parent: any) => {
    const workItemId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(workItemThreadLinks)
      .where(
        and(
          eq(workItemThreadLinks.tenant_id, tenantId),
          eq(workItemThreadLinks.work_item_id, workItemId),
        ),
      )
      .orderBy(asc(workItemThreadLinks.created_at));
    return rows.map((row) => toGraphqlWorkItemThreadLink(row));
  },
  events: async (parent: any) => {
    const workItemId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(workItemEvents)
      .where(
        and(
          eq(workItemEvents.tenant_id, tenantId),
          eq(workItemEvents.work_item_id, workItemId),
        ),
      )
      .orderBy(asc(workItemEvents.created_at));
    return rows.map((row) => toGraphqlWorkItemEvent(row));
  },
  externalRefs: async (parent: any) => {
    const workItemId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select()
      .from(workItemExternalRefs)
      .where(
        and(
          eq(workItemExternalRefs.tenant_id, tenantId),
          eq(workItemExternalRefs.work_item_id, workItemId),
        ),
      )
      .orderBy(asc(workItemExternalRefs.created_at));
    return rows.map((row) => toGraphqlWorkItemExternalRef(row));
  },
};
