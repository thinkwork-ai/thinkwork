import { snakeToCamel } from "../../utils.js";

const WORK_ITEM_ENUM_FIELDS = new Set([
  "priority",
  "openEngineDependencyState",
]);
const WORK_ITEM_STATUS_ENUM_FIELDS = new Set(["category"]);
const WORK_ITEM_EVENT_ENUM_FIELDS = new Set(["eventType"]);
const WORK_ITEM_LINK_ENUM_FIELDS = new Set(["relationship"]);
const WORK_ITEM_VIEW_ENUM_FIELDS = new Set(["viewType"]);
const WORK_ITEM_REF_ENUM_FIELDS = new Set(["provider"]);

export function toGraphqlWorkItem(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemStatus(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_STATUS_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemEvent(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_EVENT_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemThreadLink(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_LINK_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemSavedView(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_VIEW_ENUM_FIELDS);
  return result;
}

export function toGraphqlWorkItemExternalRef(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, WORK_ITEM_REF_ENUM_FIELDS);
  return result;
}

function uppercaseFields(
  row: Record<string, unknown>,
  fields: ReadonlySet<string>,
) {
  for (const field of fields) {
    if (typeof row[field] === "string") {
      row[field] = row[field].toUpperCase();
    }
  }
}
