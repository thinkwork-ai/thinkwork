export interface WikiSourceRecord {
  memoryRecordId: string;
  content?: { text?: string | null } | null;
  createdAt?: string | null;
  updatedAt?: string | null;
  factType?: string | null;
  strategyId?: string | null;
}

export type WikiSourceRow =
  | {
      kind: "resolved";
      id: string;
      record: WikiSourceRecord;
    }
  | {
      kind: "unavailable";
      id: string;
    };

export function shouldShowSourcesAffordance(
  sourceMemoryCount: number | null | undefined,
): boolean {
  return typeof sourceMemoryCount === "number" && sourceMemoryCount > 0;
}

export function resolveSourceRows(
  sourceMemoryIds: readonly string[],
  records: readonly WikiSourceRecord[],
): WikiSourceRow[] {
  const byId = new Map(records.map((record) => [record.memoryRecordId, record]));
  return sourceMemoryIds.map((id) => {
    const record = byId.get(id);
    return record
      ? { kind: "resolved", id, record }
      : { kind: "unavailable", id };
  });
}
