import { snakeToCamel } from "../../utils.js";

const LINKED_TASK_ENUM_FIELDS = new Set(["provider", "status", "syncStatus"]);
const LINKED_TASK_EVENT_ENUM_FIELDS = new Set([
  "provider",
  "eventType",
  "previousStatus",
  "newStatus",
]);

export function toGraphqlLinkedTask(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, LINKED_TASK_ENUM_FIELDS);
  return result;
}

export function toGraphqlLinkedTaskEvent(row: Record<string, unknown>) {
  const result = snakeToCamel(row);
  uppercaseFields(result, LINKED_TASK_EVENT_ENUM_FIELDS);
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
