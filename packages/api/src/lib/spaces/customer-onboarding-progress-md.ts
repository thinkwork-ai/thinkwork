import { and, asc, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { linkedTasks, tenants, threads } from "@thinkwork/database-pg/schema";

import type { LinkedTaskStatus } from "../linked-tasks/status.js";
import {
  formatGoalProgressLabel,
  renderThreadGoalProgressMarkdown,
} from "../thread-goals/progress.js";
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
import { loadCustomerOnboardingWorkItemProgressTasks } from "../work-items/progress.js";

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
  threadFolderName: string | null;
  spaceId: string | null;
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
    threadFolderName?: string | null;
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
    threadFolderName: state.threadFolderName,
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
  const customer =
    input.normalized.companyName ??
    input.normalized.customerName ??
    input.threadTitle;

  return [
    renderThreadGoalProgressMarkdown({
      threadTitle: input.threadTitle,
      goalTitle: `Complete customer onboarding for ${customer}.`,
      tasks: input.tasks,
      updatedAt: input.updatedAt,
    }).trimEnd(),
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
        workspaceFolderName: threads.workspace_folder_name,
        spaceId: threads.space_id,
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
    const nativeTasks =
      await loadCustomerOnboardingWorkItemProgressTasks(input);
    if (nativeTasks.length > 0) {
      return {
        tenantSlug: tenant.slug,
        threadId: thread.id,
        threadFolderName: thread.workspaceFolderName,
        spaceId: thread.spaceId,
        threadTitle: thread.title,
        normalized,
        tasks: nativeTasks,
      };
    }

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
      threadFolderName: thread.workspaceFolderName,
      spaceId: thread.spaceId,
      threadTitle: thread.title,
      normalized,
      tasks: taskRows
        .filter((task) => !isRemovedChecklistTask(task.metadata))
        .map((task) => {
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
    "1. All required onboarding tasks are complete; request human final review before closing the Thread.",
  ];
}

function formatRoleLabel(roleKey: string | null): string | null {
  if (!roleKey) return null;
  return formatGoalProgressLabel(roleKey);
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function isRemovedChecklistTask(metadata: unknown): boolean {
  return Boolean(
    objectRecord(objectRecord(metadata).nativeChecklist).removedAt,
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim().length > 0
    ? value.trim()
    : null;
}
