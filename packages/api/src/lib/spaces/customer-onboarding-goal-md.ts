import { and, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import { workspaceFolderName } from "@thinkwork/database-pg/utils/workspace-folder-name";
import { goals } from "@thinkwork/database-pg/schema";

import {
  writeThreadGoalFile,
  type ThreadGoalFileName,
  type ThreadGoalStorageDeps,
} from "../thread-goals/storage.js";
import {
  type CustomerOnboardingProgressRepository,
  type CustomerOnboardingProgressState,
  type CustomerOnboardingProgressTask,
  DrizzleCustomerOnboardingProgressRepository,
  renderCustomerOnboardingProgressMarkdown,
} from "./customer-onboarding-progress-md.js";

export type CustomerOnboardingGoalStatus =
  | "active"
  | "in_review"
  | "completed"
  | "cancelled";

export interface CustomerOnboardingGoalFolderFile {
  file: ThreadGoalFileName;
  content: string;
}

export interface CustomerOnboardingGoalReadiness {
  status: CustomerOnboardingGoalStatus;
  completedRequired: number;
  totalRequired: number;
  readyForReview: boolean;
}

export interface CustomerOnboardingGoalFolder {
  files: CustomerOnboardingGoalFolderFile[];
  readiness: CustomerOnboardingGoalReadiness;
}

export interface CustomerOnboardingGoalFolderWriter {
  write(input: {
    tenantSlug: string;
    threadId: string;
    file: ThreadGoalFileName;
    content: string;
  }): Promise<{ key: string; bytes: number }>;
}

export interface CustomerOnboardingGoalStatusUpdater {
  update(input: {
    tenantId: string;
    threadId: string;
    state: CustomerOnboardingProgressState;
    status: CustomerOnboardingGoalStatus;
    updatedAt: Date;
  }): Promise<void>;
}

export interface RefreshCustomerOnboardingGoalFolderDeps {
  repository?: CustomerOnboardingProgressRepository;
  writer?: CustomerOnboardingGoalFolderWriter;
  statusUpdater?: CustomerOnboardingGoalStatusUpdater;
  storage?: ThreadGoalStorageDeps;
  goalStatus?: CustomerOnboardingGoalStatus;
  now?: () => Date;
}

export async function refreshCustomerOnboardingGoalFolder(
  input: { tenantId: string; threadId: string },
  deps: RefreshCustomerOnboardingGoalFolderDeps = {},
): Promise<Array<{ key: string; bytes: number }> | null> {
  const repository =
    deps.repository ?? new DrizzleCustomerOnboardingProgressRepository();
  const state = await repository.load(input);
  if (!state) return null;

  const updatedAt = deps.now?.() ?? new Date();
  const folder = renderCustomerOnboardingGoalFolder({
    ...state,
    updatedAt,
    goalStatus: deps.goalStatus,
  });
  const nextStatus = deps.goalStatus ?? folder.readiness.status;

  const statusUpdater =
    deps.statusUpdater ?? new DrizzleCustomerOnboardingGoalStatusUpdater();
  await statusUpdater.update({
    tenantId: input.tenantId,
    threadId: input.threadId,
    state,
    status: nextStatus,
    updatedAt,
  });

  const writer =
    deps.writer ??
    ({
      write: (writeInput) => writeThreadGoalFile(writeInput, deps.storage),
    } satisfies CustomerOnboardingGoalFolderWriter);

  const writes: Array<{ key: string; bytes: number }> = [];
  for (const file of folder.files) {
    writes.push(
      await writer.write({
        tenantSlug: state.tenantSlug,
        threadId: state.threadId,
        file: file.file,
        content: file.content,
      }),
    );
  }
  return writes;
}

export async function refreshCustomerOnboardingGoalFolderSafely(
  input: { tenantId: string; threadId: string },
  deps: RefreshCustomerOnboardingGoalFolderDeps = {},
): Promise<Array<{ key: string; bytes: number }> | null> {
  try {
    return await refreshCustomerOnboardingGoalFolder(input, deps);
  } catch (error) {
    console.warn("[customer-onboarding-goal] refresh failed", {
      tenantId: input.tenantId,
      threadId: input.threadId,
      error,
    });
    return null;
  }
}

export function renderCustomerOnboardingGoalFolder(
  input: CustomerOnboardingProgressState & {
    updatedAt: Date;
    goalStatus?: CustomerOnboardingGoalStatus;
  },
): CustomerOnboardingGoalFolder {
  const readiness = customerOnboardingGoalReadiness(input.tasks);
  return {
    readiness,
    files: [
      {
        file: "GOAL.md",
        content: renderGoalMarkdown(input, readiness, input.goalStatus),
      },
      {
        file: "PROGRESS.md",
        content: renderCustomerOnboardingProgressMarkdown(input),
      },
      {
        file: "DECISIONS.md",
        content: renderDecisionsMarkdown(input),
      },
      {
        file: "ARTIFACTS.md",
        content: renderArtifactsMarkdown(input),
      },
      {
        file: "HANDOFFS.md",
        content: renderHandoffsMarkdown(input, readiness),
      },
    ],
  };
}

export function customerOnboardingGoalReadiness(
  tasks: CustomerOnboardingProgressTask[],
): CustomerOnboardingGoalReadiness {
  const activeRequired = tasks.filter(
    (task) => task.required && task.status !== "not_applicable",
  );
  const completedRequired = activeRequired.filter(
    (task) => task.status === "completed",
  ).length;
  const totalRequired = activeRequired.length;
  const readyForReview =
    totalRequired > 0 && completedRequired === totalRequired;

  return {
    status: readyForReview ? "in_review" : "active",
    completedRequired,
    totalRequired,
    readyForReview,
  };
}

class DrizzleCustomerOnboardingGoalStatusUpdater implements CustomerOnboardingGoalStatusUpdater {
  async update(input: {
    tenantId: string;
    threadId: string;
    state: CustomerOnboardingProgressState;
    status: CustomerOnboardingGoalStatus;
    updatedAt: Date;
  }): Promise<void> {
    const db = getDb();
    const [existing] = await db
      .select({ id: goals.id })
      .from(goals)
      .where(
        and(
          eq(goals.tenant_id, input.tenantId),
          eq(goals.thread_id, input.threadId),
          sql`${goals.status} IN ('active','in_review')`,
        ),
      )
      .limit(1);

    if (existing) {
      await db
        .update(goals)
        .set({
          status: input.status,
          updated_at: input.updatedAt,
        })
        .where(eq(goals.id, existing.id));
      return;
    }

    if (input.status === "completed" || input.status === "cancelled") {
      const [terminal] = await db
        .select({ id: goals.id })
        .from(goals)
        .where(
          and(
            eq(goals.tenant_id, input.tenantId),
            eq(goals.thread_id, input.threadId),
            eq(goals.status, input.status),
          ),
        )
        .limit(1);
      if (terminal) {
        await db
          .update(goals)
          .set({ updated_at: input.updatedAt })
          .where(eq(goals.id, terminal.id));
      }
      return;
    }

    if (!input.state.spaceId) return;

    const customer = customerLabel(input.state);
    const existingGoalFolders = await db
      .select({
        id: goals.id,
        workspaceFolderName: goals.workspace_folder_name,
      })
      .from(goals)
      .where(eq(goals.tenant_id, input.tenantId));
    const values = {
      tenant_id: input.tenantId,
      space_id: input.state.spaceId,
      thread_id: input.threadId,
      template_key: "customer_onboarding",
      outcome: `Complete customer onboarding for ${customer}.`,
      workspace_folder_name: workspaceFolderName(
        customer,
        existingGoalFolders.map((row) => row.workspaceFolderName ?? row.id),
        "goal",
      ),
      mode: "collaborate",
      status: input.status,
      progress_model: "linked_tasks",
      completion_rule: {
        type: "all_required_applicable_linked_tasks_complete",
      },
      review_policy: {
        required: true,
        type: "human_final_review",
      },
      folder_s3_prefix: `tenants/${input.state.tenantSlug}/threads/${input.threadId}/`,
      metadata: compactObject({
        workflow: "customer_onboarding",
        opportunityId: input.state.normalized.opportunityId,
        customerId: input.state.normalized.customerId,
        customerName: input.state.normalized.customerName,
        companyName: input.state.normalized.companyName,
        source: "customer_onboarding_goal_refresh",
      }),
      updated_at: input.updatedAt,
    };

    try {
      await db.insert(goals).values(values);
    } catch (error) {
      if (!isUniqueViolation(error)) throw error;
      await db
        .update(goals)
        .set({ status: input.status, updated_at: input.updatedAt })
        .where(
          and(
            eq(goals.tenant_id, input.tenantId),
            eq(goals.thread_id, input.threadId),
            sql`${goals.status} IN ('active','in_review')`,
          ),
        );
    }
  }
}

function renderGoalMarkdown(
  input: CustomerOnboardingProgressState & { updatedAt: Date },
  readiness: CustomerOnboardingGoalReadiness,
  goalStatus?: CustomerOnboardingGoalStatus,
): string {
  const customer = customerLabel(input);
  const statusLabel = goalStatus
    ? goalStatusText(goalStatus)
    : readiness.readyForReview
      ? "Ready for human final review."
      : "Active execution.";
  return [
    "# GOAL",
    "",
    `Outcome: Complete customer onboarding for ${customer}.`,
    "Mode: Collaborate",
    "Owner: Customer onboarding team",
    "Progress model: ThinkWork linked tasks",
    "Completion rule: all required applicable checklist rows must be completed.",
    "Review policy: human final review is required before this Thread can be marked done.",
    `Status: ${statusLabel}`,
    `Updated: ${input.updatedAt.toISOString()}`,
    "",
    "## Canonical Sources",
    "- Structured checklist state lives in Aurora linked_tasks rows.",
    "- This folder is the portable Thread Goal briefing for agents and humans.",
    "- PROGRESS.md is rendered from structured state and should not be edited as the task source of truth.",
    "",
    "## Current Completion",
    `- Required complete: ${readiness.completedRequired}/${readiness.totalRequired}`,
    `- Remaining required tasks: ${Math.max(readiness.totalRequired - readiness.completedRequired, 0)}`,
    "",
    "## Review Gate",
    readiness.readyForReview
      ? "- Ask the human owner to confirm final onboarding review before closing the Thread."
      : "- Continue the listed handoffs until required applicable rows are complete.",
    "",
  ].join("\n");
}

function goalStatusText(status: CustomerOnboardingGoalStatus): string {
  if (status === "completed") return "Completed after human review.";
  if (status === "cancelled") return "Cancelled.";
  if (status === "in_review") return "Ready for human final review.";
  return "Active execution.";
}

function renderDecisionsMarkdown(
  input: CustomerOnboardingProgressState & { updatedAt: Date },
): string {
  const lines = [
    "# DECISIONS",
    "",
    "Decisions captured from onboarding intake and manual checklist updates.",
    `Updated: ${input.updatedAt.toISOString()}`,
    "",
    "## Intake Decisions",
    ...decisionLines(input),
    "",
    "## Task Notes",
    ...taskDecisionLines(input.tasks),
    "",
  ];
  return lines.join("\n");
}

function renderArtifactsMarkdown(
  input: CustomerOnboardingProgressState & { updatedAt: Date },
): string {
  const artifacts = [
    ...input.normalized.documents.map((link) => ({
      label: link.title ?? "Document",
      url: link.url,
    })),
    ...input.normalized.links.map((link) => ({
      label: link.title ?? "Link",
      url: link.url,
    })),
  ];
  if (input.normalized.contractLink) {
    artifacts.push({
      label: "Contract link",
      url: input.normalized.contractLink,
    });
  }
  if (input.normalized.taxExemptionFormLocation) {
    artifacts.push({
      label: "Tax exemption form",
      url: input.normalized.taxExemptionFormLocation,
    });
  }
  if (input.normalized.compliancePortal) {
    artifacts.push({
      label: "Compliance portal",
      url: input.normalized.compliancePortal,
    });
  }

  return [
    "# ARTIFACTS",
    "",
    "Portable artifact manifest for this onboarding Goal.",
    `Updated: ${input.updatedAt.toISOString()}`,
    "",
    "## Referenced Artifacts",
    ...(artifacts.length === 0
      ? ["- None captured yet."]
      : artifacts.map(
          (artifact) =>
            `- ${artifact.label}${artifact.url ? `: ${artifact.url}` : ""}`,
        )),
    "",
    "## External IDs",
    ...externalIdLines(input),
    "",
  ].join("\n");
}

function renderHandoffsMarkdown(
  input: CustomerOnboardingProgressState & { updatedAt: Date },
  readiness: CustomerOnboardingGoalReadiness,
): string {
  const openTasks = input.tasks.filter(
    (task) =>
      task.status !== "completed" &&
      task.status !== "not_applicable" &&
      task.status !== "cancelled",
  );

  return [
    "# HANDOFFS",
    "",
    "Current team handoffs for driving this Goal to review.",
    `Updated: ${input.updatedAt.toISOString()}`,
    "",
    "## Current Handoffs",
    ...(openTasks.length === 0
      ? [
          readiness.readyForReview
            ? "- Human reviewer: confirm final onboarding review and close the Thread if accepted."
            : "- None.",
        ]
      : openTasks.map((task) => {
          const owner =
            task.owner ?? formatRoleLabel(task.roleKey) ?? "Unassigned";
          const note = task.notes ? ` - ${task.notes}` : "";
          return `- ${owner}: ${task.title} (${formatStatusLabel(task.status)})${note}`;
        })),
    "",
    "## Missing Intake",
    ...(input.normalized.missingFields.length === 0
      ? ["- None."]
      : input.normalized.missingFields.map((field) => `- ${field}`)),
    "",
  ].join("\n");
}

function decisionLines(input: CustomerOnboardingProgressState): string[] {
  const decisions: string[] = [];
  const source = input.normalized;

  if (source.creditTermsRequested !== null) {
    decisions.push(
      `- Credit terms requested: ${source.creditTermsRequested ? "yes" : "no"}${source.requestedTerms ? ` (${source.requestedTerms})` : ""}.`,
    );
  }
  if (source.creditApprovalNotes) {
    decisions.push(`- Credit approval notes: ${source.creditApprovalNotes}.`);
  }
  if (source.taxExempt !== null) {
    decisions.push(
      `- Tax exempt: ${source.taxExempt ? "yes" : "no"}${source.taxExemptionType ? ` (${source.taxExemptionType})` : ""}.`,
    );
  }
  if (source.billingSameAsShipping !== null) {
    decisions.push(
      `- Billing same as shipping: ${source.billingSameAsShipping ? "yes" : "no"}.`,
    );
  }
  if (source.specialRequirements) {
    decisions.push(`- Special requirements: ${source.specialRequirements}.`);
  }
  if (source.accountSetupBlockers) {
    decisions.push(`- Account setup blockers: ${source.accountSetupBlockers}.`);
  }

  return decisions.length > 0 ? decisions : ["- None captured yet."];
}

function taskDecisionLines(tasks: CustomerOnboardingProgressTask[]): string[] {
  const notedTasks = tasks.filter((task) => task.notes);
  if (notedTasks.length === 0) return ["- None captured yet."];
  return notedTasks.map((task) => {
    const owner = task.owner ?? formatRoleLabel(task.roleKey) ?? "Unassigned";
    return `- ${owner}: ${task.title} (${formatStatusLabel(task.status)}) - ${task.notes}`;
  });
}

function externalIdLines(input: CustomerOnboardingProgressState): string[] {
  const lines = [
    ["Opportunity", input.normalized.opportunityId],
    ["Customer", input.normalized.customerId],
    ["Dun & Bradstreet", input.normalized.dunAndBradstreetId],
    ["P21 customer", input.normalized.p21CustomerId],
    ["Tax code", input.normalized.taxCode],
  ]
    .filter(([, value]) => value)
    .map(([label, value]) => `- ${label}: ${value}`);
  return lines.length > 0 ? lines : ["- None captured yet."];
}

function customerLabel(input: CustomerOnboardingProgressState): string {
  return (
    input.normalized.companyName ??
    input.normalized.customerName ??
    input.threadTitle
  );
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

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function isUniqueViolation(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as { code?: unknown }).code === "23505"
  );
}
