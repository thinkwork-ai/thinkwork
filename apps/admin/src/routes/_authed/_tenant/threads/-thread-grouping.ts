// Pure helpers for grouping threads in the threads-list view.
// Files prefixed with `-` are ignored by TanStack Router's file-based
// route generation, so this is safe to import from tests.

// Computer ownership wins over Agent assignment so Computer-owned threads land
// in a "Computer" group instead of being miscounted as Unassigned. Empty-string
// IDs are normalized to "unassigned" — the schema's `ID` type does not produce
// them, but a stray "" would otherwise create a nonsensical "" group bucket.
export function threadAssigneeGroupKey(thread: {
  computerId?: string | null;
  agentId?: string | null;
}): string {
  if (thread.computerId) return "__computer";
  if (thread.agentId) return thread.agentId;
  return "__unassigned";
}

export function threadAssigneeGroupLabel(
  key: string,
  resolveAgentName: (id: string) => string | null,
): string {
  if (key === "__unassigned") return "Unassigned";
  if (key === "__computer") return "Computer";
  return resolveAgentName(key) ?? key.slice(0, 8);
}
