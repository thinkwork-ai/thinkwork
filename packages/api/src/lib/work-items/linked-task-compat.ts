export const LINKED_TASK_NATIVE_WORK_ITEM_METADATA_KEY = "nativeWorkItemId";

export interface LinkedTaskCompatReference {
  linkedTaskId: string;
  workItemId: string;
}

export function readCompatWorkItemId(metadata: unknown): string | null {
  const record =
    metadata && typeof metadata === "object" && !Array.isArray(metadata)
      ? (metadata as Record<string, unknown>)
      : {};
  const direct = record[LINKED_TASK_NATIVE_WORK_ITEM_METADATA_KEY];
  if (typeof direct === "string" && direct.trim()) return direct;
  const nativeChecklist =
    record.nativeChecklist &&
    typeof record.nativeChecklist === "object" &&
    !Array.isArray(record.nativeChecklist)
      ? (record.nativeChecklist as Record<string, unknown>)
      : {};
  const nested = nativeChecklist[LINKED_TASK_NATIVE_WORK_ITEM_METADATA_KEY];
  return typeof nested === "string" && nested.trim() ? nested : null;
}
