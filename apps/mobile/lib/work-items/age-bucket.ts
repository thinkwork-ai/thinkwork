export type WorkItemAgeBucket =
  | "overdue"
  | "due-soon"
  | "on-track"
  | "no-due-date";

const DUE_SOON_WINDOW_MS = 48 * 60 * 60 * 1000;

export function workItemAgeBucket(
  dueAt: string | null | undefined,
  now: Date,
): WorkItemAgeBucket {
  if (!dueAt) return "no-due-date";
  const dueTime = new Date(dueAt).getTime();
  if (!Number.isFinite(dueTime)) return "no-due-date";

  const delta = dueTime - now.getTime();
  if (delta < 0) return "overdue";
  if (delta <= DUE_SOON_WINDOW_MS) return "due-soon";
  return "on-track";
}
