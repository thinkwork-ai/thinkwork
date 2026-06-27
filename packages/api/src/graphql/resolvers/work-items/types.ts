import {
  and,
  asc,
  db,
  eq,
  isNull,
  workItemEvents,
  workItemExternalRefs,
  workItemLabelAssignments,
  workItemLabels,
  workItemStatuses,
  workItemThreadLinks,
} from "../../utils.js";
import {
  toGraphqlWorkItemEvent,
  toGraphqlWorkItemExternalRef,
  toGraphqlWorkItemLabel,
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
  labels: async (parent: any) => {
    const workItemId = parent.id;
    const tenantId = parent.tenantId ?? parent.tenant_id;
    const rows = await db
      .select({
        id: workItemLabels.id,
        tenant_id: workItemLabels.tenant_id,
        name: workItemLabels.name,
        slug: workItemLabels.slug,
        color: workItemLabels.color,
        description: workItemLabels.description,
        created_by_user_id: workItemLabels.created_by_user_id,
        created_at: workItemLabels.created_at,
        updated_at: workItemLabels.updated_at,
        archived_at: workItemLabels.archived_at,
      })
      .from(workItemLabelAssignments)
      .innerJoin(
        workItemLabels,
        and(
          eq(workItemLabels.tenant_id, workItemLabelAssignments.tenant_id),
          eq(workItemLabels.id, workItemLabelAssignments.label_id),
        ),
      )
      .where(
        and(
          eq(workItemLabelAssignments.tenant_id, tenantId),
          eq(workItemLabelAssignments.work_item_id, workItemId),
          isNull(workItemLabels.archived_at),
        ),
      )
      .orderBy(asc(workItemLabels.name));
    return rows.map((row) => toGraphqlWorkItemLabel(row));
  },
};
