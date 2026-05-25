import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { linkedTasks, tenants, threads } from "@thinkwork/database-pg/schema";

import type { LinkedTaskStatus } from "../linked-tasks/status.js";
import {
  writeThreadProgressMarkdown,
  type ThreadProgressStorageDeps,
} from "../thread-progress/storage.js";
import {
  CUSTOMER_ONBOARDING_TEMPLATE_KEY,
  normalizeCustomerOnboardingSource,
  type CustomerOnboardingSourceInput,
  type NormalizedCustomerOnboardingSource,
} from "./customer-onboarding-workflow.js";

type JsonRecord = Record<string, unknown>;

export interface CustomerOnboardingProgressTask {
  title: string;
  status: LinkedTaskStatus;
  required: boolean;
  blocked: boolean;
  owner: string | null;
  roleKey: string | null;
  checklistItemKey: string | null;
  notes: string | null;
  updatedAt: Date | null;
}

export interface CustomerOnboardingProgressState {
  tenantSlug: string;
  threadId: string;
  threadTitle: string;
  normalized: NormalizedCustomerOnboardingSource;
  tasks: CustomerOnboardingProgressTask[];
}

export interface CustomerOnboardingProgressRepository {
  load(input: {
    tenantId: string;
    threadId: string;
  }): Promise<CustomerOnboardingProgressState | null>;
}

export interface CustomerOnboardingProgressWriter {
  write(input: {
    tenantSlug: string;
    threadId: string;
    content: string;
  }): Promise<{ key: string; bytes: number }>;
}

export interface RefreshCustomerOnboardingProgressDeps {
  repository?: CustomerOnboardingProgressRepository;
  writer?: CustomerOnboardingProgressWriter;
  storage?: ThreadProgressStorageDeps;
  now?: () => Date;
}

export async function refreshCustomerOnboardingProgressMarkdown(
  input: { tenantId: string; threadId: string },
  deps: RefreshCustomerOnboardingProgressDeps = {},
): Promise<{ key: string; bytes: number } | null> {
  const repository =
    deps.repository ?? new DrizzleCustomerOnboardingProgressRepository();
  const state = await repository.load(input);
  if (!state) return null;

  const content = renderCustomerOnboardingProgressMarkdown({
    ...state,
    updatedAt: deps.now?.() ?? new Date(),
  });
  const writer =
    deps.writer ??
    ({
      write: (writeInput) =>
        writeThreadProgressMarkdown(writeInput, deps.storage),
    } satisfies CustomerOnboardingProgressWriter);

  return writer.write({
    tenantSlug: state.tenantSlug,
    threadId: state.threadId,
    content,
  });
}

export async function refreshCustomerOnboardingProgressMarkdownSafely(
  input: { tenantId: string; threadId: string },
  deps: RefreshCustomerOnboardingProgressDeps = {},
): Promise<{ key: string; bytes: number } | null> {
  try {
    return await refreshCustomerOnboardingProgressMarkdown(input, deps);
  } catch (error) {
    console.warn("[customer-onboarding-progress] refresh failed", {
      tenantId: input.tenantId,
      threadId: input.threadId,
      error,
    });
    return null;
  }
}

export function renderCustomerOnboardingProgressMarkdown(input: {
  threadTitle: string;
  normalized: NormalizedCustomerOnboardingSource;
  tasks: CustomerOnboardingProgressTask[];
  updatedAt: Date;
}): string {
  const activeRequiredTasks = input.tasks.filter(
    (task) => task.required && task.status !== "not_applicable",
  );
  const completedRequired = activeRequiredTasks.filter(
    (task) => task.status === "completed",
  ).length;
  const totalRequired = activeRequiredTasks.length;
  const percent =
    totalRequired === 0
      ? 100
      : Math.round((completedRequired / totalRequired) * 100);
  const customer =
    input.normalized.companyName ??
    input.normalized.customerName ??
    input.threadTitle;
  const status =
    completedRequired === totalRequired && totalRequired > 0
      ? "Ready for final review."
      : `Waiting on ${totalRequired - completedRequired} required task${
          totalRequired - completedRequired === 1 ? "" : "s"
        }.`;

  return [
    "# PROGRESS",
    "",
    `Thread: ${input.threadTitle}`,
    `Goal: Complete customer onboarding for ${customer}.`,
    `Status: ${status}`,
    `Updated: ${input.updatedAt.toISOString()}`,
    "",
    "## Progress",
    `- Required complete: ${completedRequired}/${totalRequired}`,
    `- Overall: ${percent}%`,
    "",
    "## Tasks",
    "| Task | Status | Owner | Required | Blocker/Notes |",
    "| --- | --- | --- | --- | --- |",
    ...input.tasks.map(
      (task) =>
        `| ${[
          tableCell(task.title),
          tableCell(formatStatusLabel(task.status)),
          tableCell(
            task.owner ?? formatRoleLabel(task.roleKey) ?? "Unassigned",
          ),
          task.required ? "Yes" : "No",
          tableCell(
            task.blocked ? (task.notes ?? "Blocked") : (task.notes ?? ""),
          ),
        ].join(" | ")} |`,
    ),
    "",
    "## Blockers",
    ...blockerLines(input.tasks),
    "",
    "## Missing Information",
    ...missingInformationLines(input.normalized.missingFields),
    "",
    "## Next Steps",
    ...nextStepLines({ normalized: input.normalized, tasks: input.tasks }),
    "",
  ].join("\n");
}

export class DrizzleCustomerOnboardingProgressRepository
  implements CustomerOnboardingProgressRepository
{
  async load(input: {
    tenantId: string;
    threadId: string;
  }): Promise<CustomerOnboardingProgressState | null> {
    const db = getDb();
    const [tenant] = await db
      .select({ slug: tenants.slug })
      .from(tenants)
      .where(eq(tenants.id, input.tenantId))
      .limit(1);
    if (!tenant?.slug) return null;

    const [thread] = await db
      .select({
        id: threads.id,
        title: threads.title,
        metadata: threads.metadata,
      })
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, input.tenantId),
          eq(threads.id, input.threadId),
        ),
      )
      .limit(1);
    if (!thread) return null;

    const metadata = objectRecord(thread.metadata);
    const onboarding = objectRecord(metadata.customerOnboarding);
    if (onboarding.workflow !== CUSTOMER_ONBOARDING_TEMPLATE_KEY) return null;

    const normalized = normalizeProgressFacts(objectRecord(onboarding.facts));
    const taskRows = await db
      .select()
      .from(linkedTasks)
      .where(
        and(
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.thread_id, input.threadId),
          eq(linkedTasks.provider, "thinkwork"),
        ),
      )
      .orderBy(asc(linkedTasks.created_at));

    return {
      tenantSlug: tenant.slug,
      threadId: thread.id,
      threadTitle: thread.title,
      normalized,
      tasks: taskRows.map((task) => {
        const taskMetadata = objectRecord(task.metadata);
        const nativeChecklist = objectRecord(taskMetadata.nativeChecklist);
        return {
          title: task.title,
          status: task.status as LinkedTaskStatus,
          required: task.required,
          blocked: task.blocked,
          owner: stringValue(task.assignee_display),
          roleKey: stringValue(task.role_key),
          checklistItemKey: stringValue(taskMetadata.checklistItemKey),
          notes:
            stringValue(nativeChecklist.lastStatusNote) ??
            stringValue(taskMetadata.note) ??
            null,
          updatedAt: task.updated_at ?? null,
        };
      }),
    };
  }
}

function normalizeProgressFacts(
  facts: JsonRecord,
): NormalizedCustomerOnboardingSource {
  const raw = objectRecord(facts.raw);
  return normalizeCustomerOnboardingSource({
    ...raw,
    ...facts,
  } as CustomerOnboardingSourceInput);
}

function blockerLines(tasks: CustomerOnboardingProgressTask[]): string[] {
  const blockers = tasks.filter(
    (task) => task.blocked || task.status === "blocked",
  );
  if (blockers.length === 0) return ["- None."];
  return blockers.map((task) => {
    const owner = task.owner ?? formatRoleLabel(task.roleKey) ?? "Unassigned";
    return `- ${owner}: ${task.title}${task.notes ? ` - ${task.notes}` : ""}`;
  });
}

function missingInformationLines(fields: string[]): string[] {
  if (fields.length === 0) return ["- None."];
  return fields.map((field) => `- ${field}`);
}

function nextStepLines(input: {
  normalized: NormalizedCustomerOnboardingSource;
  tasks: CustomerOnboardingProgressTask[];
}): string[] {
  if (input.normalized.missingFields.length > 0) {
    return [
      `1. Capture missing intake: ${input.normalized.missingFields.join(", ")}.`,
    ];
  }
  const blocked = input.tasks.find(
    (task) => task.blocked || task.status === "blocked",
  );
  if (blocked) {
    const owner =
      blocked.owner ?? formatRoleLabel(blocked.roleKey) ?? "Unassigned";
    return [`1. Resolve blocker on ${blocked.title} with ${owner}.`];
  }
  const active = input.tasks.find(
    (task) =>
      task.required &&
      !["completed", "not_applicable", "cancelled"].includes(task.status),
  );
  if (active) {
    const owner =
      active.owner ?? formatRoleLabel(active.roleKey) ?? "Unassigned";
    return [`1. Advance ${active.title} with ${owner}.`];
  }
  return [
    "1. All required onboarding tasks are complete; mark the Thread completed.",
  ];
}

function formatStatusLabel(status: string): string {
  return status
    .split("_")
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
}

function formatRoleLabel(roleKey: string | null): string | null {
  if (!roleKey) return null;
  return formatStatusLabel(roleKey);
}

function tableCell(value: string): string {
  return value.replace(/\|/g, "\\|").replace(/\n/g, " ").trim();
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
