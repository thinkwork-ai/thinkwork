import type { LinkedTaskStatus } from "../linked-tasks/status.js";

export type ThreadGoalReviewStatus = "active" | "in_review";

export interface ThreadGoalProgressTask {
  required?: boolean | null;
  status?: LinkedTaskStatus | string | null;
}

export interface ThreadGoalProgressMarkdownTask extends ThreadGoalProgressTask {
  title: string;
  owner?: string | null;
  roleKey?: string | null;
  blocked?: boolean | null;
  notes?: string | null;
}

export interface ThreadGoalTaskProgress {
  completedRequired: number;
  totalRequired: number;
  remainingRequired: number;
  percent: number;
  readyForReview: boolean;
  noRequiredTasks: boolean;
  status: ThreadGoalReviewStatus;
}

export function deriveThreadGoalTaskProgress(
  tasks: ThreadGoalProgressTask[],
): ThreadGoalTaskProgress {
  const applicableRequiredTasks = tasks.filter(
    (task) =>
      task.required !== false && statusToken(task.status) !== "not_applicable",
  );
  const completedRequired = applicableRequiredTasks.filter(
    (task) => statusToken(task.status) === "completed",
  ).length;
  const totalRequired = applicableRequiredTasks.length;
  const readyForReview =
    totalRequired > 0 && completedRequired === totalRequired;

  return {
    completedRequired,
    totalRequired,
    remainingRequired: Math.max(totalRequired - completedRequired, 0),
    percent:
      totalRequired === 0
        ? 0
        : Math.round((completedRequired / totalRequired) * 100),
    readyForReview,
    noRequiredTasks: totalRequired === 0,
    status: readyForReview ? "in_review" : "active",
  };
}

export function renderThreadGoalProgressMarkdown(input: {
  threadTitle: string;
  goalTitle: string;
  tasks: ThreadGoalProgressMarkdownTask[];
  updatedAt: Date;
}): string {
  const progress = deriveThreadGoalTaskProgress(input.tasks);

  return [
    "# PROGRESS",
    "",
    `Thread: ${input.threadTitle}`,
    `Goal: ${input.goalTitle}`,
    `Status: ${threadGoalProgressStatusLine(progress)}`,
    `Updated: ${input.updatedAt.toISOString()}`,
    "",
    "## Progress",
    `- Required complete: ${progress.completedRequired}/${progress.totalRequired}`,
    `- Overall: ${progress.percent}%`,
    "",
    "## Tasks",
    "| Task | Status | Owner | Required | Blocker/Notes |",
    "| --- | --- | --- | --- | --- |",
    ...input.tasks.map(
      (task) =>
        `| ${[
          tableCell(task.title),
          tableCell(
            formatGoalProgressLabel(String(task.status ?? "unknown")) ??
              "Unknown",
          ),
          tableCell(
            task.owner ??
              formatGoalProgressLabel(task.roleKey ?? "") ??
              "Unassigned",
          ),
          task.required === false ? "No" : "Yes",
          tableCell(
            task.blocked ? (task.notes ?? "Blocked") : (task.notes ?? ""),
          ),
        ].join(" | ")} |`,
    ),
    "",
  ].join("\n");
}

export function threadGoalProgressStatusLine(
  progress: ThreadGoalTaskProgress,
): string {
  if (progress.noRequiredTasks) return "No required tasks.";
  if (progress.readyForReview) return "Ready for final review.";
  return `Waiting on ${progress.remainingRequired} required task${
    progress.remainingRequired === 1 ? "" : "s"
  }.`;
}

export function formatGoalProgressLabel(value: string): string | null {
  const label = value
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return label || null;
}

function statusToken(value: unknown): string | null {
  if (value === undefined || value === null) return null;
  const normalized = String(value)
    .trim()
    .toLowerCase()
    .replace(/[\s/-]+/g, "_");
  return normalized.length > 0 ? normalized : null;
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}
