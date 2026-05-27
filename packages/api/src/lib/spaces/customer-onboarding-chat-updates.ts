import { and, eq } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  linkedTaskEvents,
  linkedTasks,
  messages,
  threads,
} from "@thinkwork/database-pg/schema";

import {
  CUSTOMER_ONBOARDING_TEMPLATE_KEY,
  normalizeCustomerOnboardingSource,
  type CustomerOnboardingSourceInput,
  type NormalizedCustomerOnboardingSource,
} from "./customer-onboarding-workflow.js";
import { refreshCustomerOnboardingGoalFolderSafely } from "./customer-onboarding-goal-md.js";
import type { LinkedTaskStatus } from "../linked-tasks/status.js";

interface ApplyCustomerOnboardingChatUpdateInput {
  tenantId: string;
  threadId: string;
  content: string;
  senderUserId?: string | null;
}

export interface CustomerOnboardingChatUpdateResult {
  handled: boolean;
  agentDispatchRequired: boolean;
  assistantMessageId: string | null;
  assistantContent: string;
  missingFields: string[];
  statusRequest: boolean;
  addedTasks: Array<{
    title: string;
  }>;
  removedTasks: Array<{
    title: string;
  }>;
  unmatchedTaskRemovals: Array<{
    title: string;
  }>;
  statusChanges: Array<{
    checklistItemKey: string;
    title: string;
    previousStatus: LinkedTaskStatus;
    nextStatus: LinkedTaskStatus;
  }>;
  assignmentChanges: Array<{
    checklistItemKey: string;
    title: string;
    previousAssignee: string | null;
    nextAssignee: string;
  }>;
}

type JsonRecord = Record<string, unknown>;

const TASK_KEY_ALIASES: Array<{
  key: string;
  patterns: RegExp[];
}> = [
  {
    key: "dun_and_bradstreet_check",
    patterns: [/\b(?:dun\s*&\s*bradstreet|d&b|dnb)\b/i],
  },
  {
    key: "tax_exemption_forms",
    patterns: [/\btax exemption forms?\b/i, /\bexemption forms?\b/i],
  },
  {
    key: "credit_check",
    patterns: [/\bcredit check\b/i, /\bcredit review\b/i, /\bcredit\b/i],
  },
  {
    key: "docusign_package",
    patterns: [/\bdocusign\b/i, /\bcontract\b/i, /\border form\b/i],
  },
  {
    key: "p21_customer_setup",
    patterns: [
      /\bp21\b/i,
      /\bdata entry\b/i,
      /\bcustomer information\b/i,
      /\bcustomer setup\b/i,
      /\berp\b/i,
    ],
  },
  {
    key: "missing_onboarding_information",
    patterns: [/\bmissing onboarding information\b/i, /\bmissing intake\b/i],
  },
  {
    key: "final_onboarding_review",
    patterns: [/\bfinal onboarding review\b/i, /\bfinal review\b/i],
  },
];

const DONE_WORDS =
  /\b(?:done|complete|completed|check|checked|collected|received|signed|approved|entered|created|set up|setup)\b/i;
const CREDIT_APPROVED_WORDS =
  /\b(?:credit\s+(?:check|review)\s+)?(?:approved|complete|completed|done)\b|\blimit\s+(?:set|approved)\b|\bapproved\s+(?:for|at)\b/i;
const CREDIT_EVIDENCE_WORDS =
  /\b(?:credit|credit\s+check|credit\s+review|credit\s+limit|ran\s+(?:their\s+|the\s+)?credit)\b/i;
const MONEY_AMOUNT = /\$\s?\d[\d,]*(?:\.\d{2})?\s?(?:k|m)?\b/i;

const STATUS_REQUEST =
  /\b(?:what(?:'s| is)?|show|give me|current|latest)?\s*(?:the\s+)?(?:onboarding\s+)?(?:status|progress|checklist)\b/i;
const ASSIGNMENT_REQUEST =
  /\b(?:who(?:'s| is)?|whose|who is|show|what(?:'s| is)?)\s+(?:assigned|handling|owns?|owner|responsible)\b/i;
const EMAIL_DELIVERY_REQUEST = /\b(?:e-?mail|mail)\b/i;

const BLOCKED_WORDS =
  /\b(?:blocked|blocker|stuck|waiting on|waiting for|hold|on hold|cannot|can't)\b/i;
const IN_PROGRESS_WORDS =
  /\b(?:sent|started|working|in progress|pending|waiting on|waiting for|submitted)\b/i;
const NOT_APPLICABLE_WORDS =
  /\b(?:not applicable|n\/a|na|not needed|skip|skipped|waived)\b/i;
const ADD_TASK_WORDS =
  /\b(?:add|create|new|put)\b.*\b(?:task|checklist|todo|to-do|tasklist|task list)\b|\b(?:add|put)\b.+\b(?:to|on)\s+(?:the\s+)?(?:thread|checklist|tasklist|task list)\b/i;
const REMOVE_TASK_WORDS =
  /\b(?:remove|delete|drop)\b.*\b(?:task|checklist|todo|to-do|tasklist|task list)\b|\b(?:remove|delete|drop)\b.+\bfrom\s+(?:the\s+)?(?:thread|checklist|tasklist|task list)\b/i;
const REMOVE_COMMAND_WORDS =
  /^(?:please\s+)?(?:remove|delete|drop)(?:\s+(?:this|the)?\s*(?:task|checklist item|todo|to-do))?\.?$/i;

export async function applyCustomerOnboardingChatUpdate(
  input: ApplyCustomerOnboardingChatUpdateInput,
): Promise<CustomerOnboardingChatUpdateResult | null> {
  const db = getDb();
  const extracted = extractCustomerOnboardingChatUpdate(input.content);
  const agentDispatchRequired = shouldDispatchAgentForCustomerOnboardingMessage(
    input.content,
  );

  const [thread] = await db
    .select()
    .from(threads)
    .where(
      and(
        eq(threads.tenant_id, input.tenantId),
        eq(threads.id, input.threadId),
      ),
    )
    .limit(1);
  if (!thread) return null;

  const threadMetadata = objectRecord(thread.metadata);
  const onboarding = objectRecord(threadMetadata.customerOnboarding);
  if (onboarding.workflow !== CUSTOMER_ONBOARDING_TEMPLATE_KEY) return null;
  if (!thread.space_id) return null;
  const hasExtractedSignal = hasCustomerOnboardingSignal(extracted);

  const previousFacts = objectRecord(onboarding.facts);
  const mergedOpportunity = mergeOnboardingFacts(
    previousFacts,
    extracted.facts,
  );
  const normalized = normalizeCustomerOnboardingSource(mergedOpportunity);
  const now = new Date();

  const result = await db.transaction(async (tx) => {
    if (hasExtractedSignal) {
      const nextMetadata = buildUpdatedThreadMetadata({
        current: threadMetadata,
        normalized,
        extracted,
        updatedAt: now,
        updatedByUserId: input.senderUserId ?? null,
      });

      await tx
        .update(threads)
        .set({ metadata: nextMetadata, updated_at: now })
        .where(eq(threads.id, input.threadId));
    }

    const taskRows = await tx
      .select()
      .from(linkedTasks)
      .where(
        and(
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.thread_id, input.threadId),
          eq(linkedTasks.provider, "thinkwork"),
        ),
      );

    const activeTaskRows = taskRows.filter(
      (task) => !isRemovedChecklistTask(task),
    );
    const statusChanges: CustomerOnboardingChatUpdateResult["statusChanges"] =
      [];
    const assignmentChanges: CustomerOnboardingChatUpdateResult["assignmentChanges"] =
      [];
    const addedTasks: CustomerOnboardingChatUpdateResult["addedTasks"] = [];
    const removedTasks: CustomerOnboardingChatUpdateResult["removedTasks"] = [];
    const unmatchedTaskRemovals: CustomerOnboardingChatUpdateResult["unmatchedTaskRemovals"] =
      [];
    const explicitStatusByKey = new Map(
      extracted.taskStatusUpdates.map((update) => [update.key, update]),
    );
    const assignmentByKey = new Map(
      extracted.taskAssignments.map((assignment) => [
        assignment.key,
        assignment,
      ]),
    );

    for (const addition of extracted.taskAdditions) {
      if (findTaskByTitle(activeTaskRows, addition.title)) continue;

      const restored = findRemovedCustomTaskByTitle(taskRows, addition.title);
      if (restored) {
        const restoredMetadata = restoreRemovedChecklistMetadata({
          current: restored.metadata,
          note: addition.note,
          updatedAt: now,
          updatedByUserId: input.senderUserId ?? null,
        });
        const [updated] = await tx
          .update(linkedTasks)
          .set({
            status: "todo",
            blocked: false,
            required: true,
            sync_status: "synced",
            last_synced_at: now,
            assignee_display: addition.assigneeDisplay,
            metadata: restoredMetadata,
            updated_at: now,
          })
          .where(eq(linkedTasks.id, restored.id))
          .returning();
        activeTaskRows.push(updated);
        addedTasks.push({ title: updated.title });
        continue;
      }

      const checklistItemKey = customChecklistItemKey(addition.title);
      const [created] = await tx
        .insert(linkedTasks)
        .values({
          tenant_id: input.tenantId,
          space_id: thread.space_id,
          thread_id: input.threadId,
          checklist_item_id: null,
          provider: "thinkwork",
          external_task_id: `thinkwork:${input.threadId}:${checklistItemKey}`,
          external_task_url: null,
          title: addition.title,
          required: true,
          role_key: null,
          assignee_display: addition.assigneeDisplay,
          assignee_external_id: null,
          status: "todo",
          blocked: false,
          sync_status: "synced",
          last_synced_at: now,
          metadata: {
            workflow: "customer_onboarding",
            systemOfRecord: "thinkwork",
            checklistItemKey,
            customChecklistTask: true,
            nativeChecklist: {
              createdFrom: "customer_onboarding_chat_update",
              createdNote: addition.note,
              createdAt: now.toISOString(),
              createdByUserId: input.senderUserId ?? null,
            },
          },
          created_at: now,
          updated_at: now,
        })
        .returning();

      await tx.insert(linkedTaskEvents).values({
        tenant_id: input.tenantId,
        linked_task_id: created.id,
        space_id: created.space_id,
        thread_id: input.threadId,
        provider: "thinkwork",
        event_type: "created",
        new_status: "todo",
        message: `${created.title} added to the onboarding checklist from Customer Onboarding chat.`,
        metadata: {
          source: "customer_onboarding_chat_update",
          checklistItemKey,
          customChecklistTask: true,
          assigneeDisplay: addition.assigneeDisplay,
        },
        occurred_at: now,
      });

      activeTaskRows.push(created);
      addedTasks.push({ title: created.title });
    }

    for (const removal of extracted.taskRemovals) {
      const task = findTaskForRemoval(activeTaskRows, removal);
      if (!task) {
        unmatchedTaskRemovals.push({ title: removal.title });
        continue;
      }

      const previousStatus = task.status as LinkedTaskStatus;
      const nextMetadata = markChecklistTaskRemoved({
        current: task.metadata,
        note: removal.note,
        updatedAt: now,
        updatedByUserId: input.senderUserId ?? null,
      });
      await tx
        .update(linkedTasks)
        .set({
          status: "cancelled",
          blocked: false,
          required: false,
          sync_status: "synced",
          last_synced_at: now,
          metadata: nextMetadata,
          updated_at: now,
        })
        .where(eq(linkedTasks.id, task.id));

      await tx.insert(linkedTaskEvents).values({
        tenant_id: input.tenantId,
        linked_task_id: task.id,
        space_id: task.space_id,
        thread_id: input.threadId,
        provider: "thinkwork",
        event_type: "status_changed",
        previous_status: previousStatus,
        new_status: "cancelled",
        message: `${task.title} removed from the onboarding checklist from Customer Onboarding chat.`,
        metadata: {
          source: "customer_onboarding_chat_update",
          checklistItemKey: stringValue(
            objectRecord(task.metadata).checklistItemKey,
          ),
          removed: true,
        },
        occurred_at: now,
      });

      const index = activeTaskRows.findIndex((row) => row.id === task.id);
      if (index >= 0) activeTaskRows.splice(index, 1);
      removedTasks.push({ title: task.title });
    }

    for (const task of activeTaskRows) {
      const key = stringValue(objectRecord(task.metadata).checklistItemKey);
      if (!key) continue;

      const previousStatus = task.status as LinkedTaskStatus;
      const nextStatus = desiredStatusForTask({
        checklistItemKey: key,
        currentStatus: previousStatus,
        normalized,
        completedTaskKeys: extracted.completedTaskKeys,
        explicitStatus: explicitStatusByKey.get(key)?.status,
      });
      const assignment = assignmentByKey.get(key);
      const nextAssigneeDisplay =
        assignment?.assigneeDisplay ?? task.assignee_display;
      const assigneeChanged =
        assignment !== undefined &&
        nextAssigneeDisplay !== task.assignee_display;
      const nextRequired = desiredRequiredForTask({
        checklistItemKey: key,
        currentRequired: task.required,
        normalized,
      });
      const requiredChanged = nextRequired !== task.required;

      if (
        nextStatus === previousStatus &&
        !assigneeChanged &&
        !requiredChanged
      ) {
        continue;
      }

      const nextTaskMetadata = compactObject({
        ...objectRecord(task.metadata),
        nativeChecklist: compactObject({
          ...objectRecord(objectRecord(task.metadata).nativeChecklist),
          lastStatusNote:
            explicitStatusByKey.get(key)?.note ??
            "Updated from Customer Onboarding chat response.",
          lastStatusMetadata: {
            source: "customer_onboarding_chat_update",
            extractedFacts: extracted.facts,
          },
          lastStatusUpdatedAt: now.toISOString(),
          lastStatusUpdatedByUserId: input.senderUserId ?? null,
          lastAssignmentNote: assignment?.note,
          lastAssignmentUpdatedAt: assignment ? now.toISOString() : undefined,
          lastAssignmentUpdatedByUserId: assignment
            ? (input.senderUserId ?? null)
            : undefined,
        }),
      });

      await tx
        .update(linkedTasks)
        .set({
          status: nextStatus,
          blocked: nextStatus === "blocked",
          sync_status: "synced",
          last_synced_at: now,
          assignee_display: nextAssigneeDisplay,
          required: nextRequired,
          metadata: nextTaskMetadata,
          updated_at: now,
        })
        .where(eq(linkedTasks.id, task.id));

      if (nextStatus !== previousStatus) {
        await tx.insert(linkedTaskEvents).values({
          tenant_id: input.tenantId,
          linked_task_id: task.id,
          space_id: task.space_id,
          thread_id: input.threadId,
          provider: "thinkwork",
          event_type:
            nextStatus === "completed" ? "completed" : "status_changed",
          previous_status: previousStatus,
          new_status: nextStatus,
          message: `${task.title} marked ${nextStatus.replace(/_/g, " ")} from Customer Onboarding chat.`,
          metadata: {
            source: "customer_onboarding_chat_update",
            checklistItemKey: key,
          },
          occurred_at: now,
        });

        statusChanges.push({
          checklistItemKey: key,
          title: task.title,
          previousStatus,
          nextStatus,
        });
      }
      if (assignment && assigneeChanged) {
        await tx.insert(linkedTaskEvents).values({
          tenant_id: input.tenantId,
          linked_task_id: task.id,
          space_id: task.space_id,
          thread_id: input.threadId,
          provider: "thinkwork",
          event_type: "reassigned",
          previous_status: previousStatus,
          new_status: nextStatus,
          message: `${task.title} reassigned to ${assignment.assigneeDisplay} from Customer Onboarding chat.`,
          metadata: {
            source: "customer_onboarding_chat_update",
            checklistItemKey: key,
            assigneeDisplay: assignment.assigneeDisplay,
          },
          occurred_at: now,
        });

        assignmentChanges.push({
          checklistItemKey: key,
          title: task.title,
          previousAssignee: task.assignee_display,
          nextAssignee: assignment.assigneeDisplay,
        });
      }
    }

    const shouldHandle =
      extracted.assignmentRequest ||
      extracted.statusRequest ||
      hasExtractedSignal;
    if (!shouldHandle) {
      return {
        handled: false,
        agentDispatchRequired,
        assistantMessageId: null,
        assistantContent: "",
        missingFields: normalized.missingFields,
        statusRequest: extracted.statusRequest,
        addedTasks,
        removedTasks,
        unmatchedTaskRemovals,
        statusChanges,
        assignmentChanges,
      };
    }

    const assistantContent = extracted.assignmentRequest
      ? buildAssignmentStatusSummary({
          taskRows: activeTaskRows,
          statusChanges,
          assignmentChanges,
          requestedTaskKey: extracted.assignmentTaskKey,
        })
      : extracted.statusRequest
        ? buildProgressStatusSummary({
            normalized,
            taskRows: activeTaskRows,
            statusChanges,
          })
        : hasExtractedSignal
          ? buildAssistantSummary({
              normalized,
              statusChanges,
              completedTaskKeys: extracted.completedTaskKeys,
              assignmentChanges,
              addedTasks,
              removedTasks,
              unmatchedTaskRemovals,
            })
          : buildCustomerOnboardingOnlySummary(normalized);
    const [assistantMessage] = await tx
      .insert(messages)
      .values({
        thread_id: input.threadId,
        tenant_id: input.tenantId,
        role: "assistant",
        content: assistantContent,
        sender_type: "system",
        metadata: {
          kind: "customer_onboarding_chat_update",
          workflow: "customer_onboarding",
          statusRequest: extracted.statusRequest,
          assignmentRequest: extracted.assignmentRequest,
          agentDispatchRequired,
          missingFields: normalized.missingFields,
          statusChanges,
          assignmentChanges,
          addedTasks,
          removedTasks,
          unmatchedTaskRemovals,
        },
        created_at: now,
      })
      .returning({ id: messages.id });

    return {
      handled: true,
      agentDispatchRequired,
      assistantMessageId: assistantMessage?.id ?? null,
      assistantContent,
      missingFields: normalized.missingFields,
      statusRequest: extracted.statusRequest,
      addedTasks,
      removedTasks,
      unmatchedTaskRemovals,
      statusChanges,
      assignmentChanges,
    };
  });

  if (result.handled) {
    await refreshCustomerOnboardingGoalFolderSafely({
      tenantId: input.tenantId,
      threadId: input.threadId,
    });
  }

  return result;
}

export function extractCustomerOnboardingChatUpdate(content: string): {
  facts: CustomerOnboardingSourceInput;
  completedTaskKeys: string[];
  taskStatusUpdates: Array<{
    key: string;
    status: LinkedTaskStatus;
    note: string;
  }>;
  taskAssignments: Array<{
    key: string;
    assigneeDisplay: string;
    note: string;
  }>;
  taskAdditions: Array<{
    title: string;
    note: string;
    assigneeDisplay: string | null;
  }>;
  taskRemovals: Array<{
    title: string;
    key: string | null;
    note: string;
  }>;
  statusRequest: boolean;
  assignmentRequest: boolean;
  assignmentTaskKey: string | null;
} {
  const facts: CustomerOnboardingSourceInput = {};
  const rawSegments = content
    .split(/(?:[\n;]+|(?<=[.!?])\s+)/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
  const segments = foldContinuationTaskMutations(rawSegments);
  const whole = content.trim();

  for (const segment of segments) {
    const lower = segment.toLowerCase();
    const url = firstUrl(segment);
    if (/\bopportunity (?:link|url)\b|\bquote link\b/.test(lower)) {
      facts.opportunityUrl = url ?? valueAfterLabel(segment);
    } else if (/\bsales (?:owner|rep)\b/.test(lower)) {
      facts.salesRep = valueAfterLabel(segment);
    } else if (/\bprimary (?:customer )?contact\b/.test(lower)) {
      const person = personAfterLabel(segment);
      facts.primaryContact = person;
      facts.contacts = [person];
    } else if (/\baccounts payable contact\b|\bap contact\b/.test(lower)) {
      facts.accountsPayableContact = personAfterLabel(segment);
    } else if (
      /\bestimated (?:deal |first-order )?value\b|\bdeal value\b/.test(lower)
    ) {
      facts.dealValue = valueAfterLabel(segment);
    } else if (/\bproduct (?:plan|class)\b|\bcustomer class\b/.test(lower)) {
      facts.productPlan = valueAfterLabel(segment);
    } else if (
      /\btarget (?:onboarding |close )?date\b|\bclose date\b/.test(lower)
    ) {
      facts.closeDate = valueAfterLabel(segment);
    } else if (
      /\bcontract link\b|\border-form link\b|\border form link\b/.test(lower)
    ) {
      if (url) {
        facts.contractLink = url;
        facts.documents = [{ title: "Contract or order form", url }];
      }
    } else if (/\bbilling address\b/.test(lower)) {
      facts.billingAddress = valueAfterLabel(segment);
    } else if (/\bshipping address\b/.test(lower)) {
      if (/\bsame as billing\b/.test(lower)) {
        facts.billingSameAsShipping = true;
      } else {
        facts.shippingAddress = valueAfterLabel(segment);
      }
    } else if (
      /\btax exempt\b|\bagricultural\/sales-tax exempt\b/.test(lower)
    ) {
      facts.taxExempt = booleanFromText(segment);
    } else if (/\bcredit terms(?: requested)?\b/.test(lower)) {
      facts.creditTermsRequested = booleanFromText(segment);
    } else if (isCreditEvidenceSegment(segment)) {
      facts.creditApprovalNotes = segment;
      if (CREDIT_APPROVED_WORDS.test(segment)) {
        facts.creditTermsRequested = true;
        const amount = segment.match(MONEY_AMOUNT)?.[0];
        if (amount) {
          facts.requestedTerms = `Credit limit ${normalizeMoneyAmount(amount)}`;
        }
      }
    } else if (/\bdocusign recipient\b/.test(lower)) {
      facts.docusignRecipient = personAfterLabel(segment);
    } else if (/\bdun\s*&\s*bradstreet id\b|\bd&b id\b/.test(lower)) {
      facts.dunAndBradstreetId = valueAfterLabel(segment);
    }
  }

  if (!facts.opportunityUrl) {
    const opportunityUrl = labeledUrl(whole, /opportunity (?:link|url)/i);
    if (opportunityUrl) {
      facts.opportunityUrl = opportunityUrl;
    }
  }
  if (!facts.contractLink) {
    const contractUrl = labeledUrl(whole, /(?:contract|docusign) link/i);
    if (contractUrl) {
      facts.contractLink = contractUrl;
      facts.documents = [{ title: "Contract or order form", url: contractUrl }];
    }
  }

  const completedTaskKeys = new Set<string>();
  const taskStatusUpdates = new Map<
    string,
    { key: string; status: LinkedTaskStatus; note: string }
  >();
  const taskAssignments = new Map<
    string,
    { key: string; assigneeDisplay: string; note: string }
  >();
  const taskAdditions = new Map<
    string,
    { title: string; note: string; assigneeDisplay: string | null }
  >();
  const taskRemovals = new Map<
    string,
    { title: string; key: string | null; note: string }
  >();
  for (const segment of segments) {
    const prefixedTaskCommand = taskCommandFromPrefixedSegment(segment);
    if (prefixedTaskCommand?.type === "removal") {
      taskRemovals.set(
        prefixedTaskCommand.key ??
          normalizeTaskTitleForMatch(prefixedTaskCommand.title),
        {
          title: prefixedTaskCommand.title,
          key: prefixedTaskCommand.key,
          note: segment,
        },
      );
      continue;
    }
    if (prefixedTaskCommand?.type === "status") {
      taskStatusUpdates.set(prefixedTaskCommand.key, {
        key: prefixedTaskCommand.key,
        status: prefixedTaskCommand.status,
        note: segment,
      });
      if (prefixedTaskCommand.status === "completed") {
        completedTaskKeys.add(prefixedTaskCommand.key);
      }
      continue;
    }
    if (prefixedTaskCommand?.type === "assignment") {
      taskAssignments.set(prefixedTaskCommand.key, {
        key: prefixedTaskCommand.key,
        assigneeDisplay: prefixedTaskCommand.assigneeDisplay,
        note: segment,
      });
      continue;
    }

    const taskAdditionTitle = taskAdditionTitleFromSegment(segment);
    if (taskAdditionTitle) {
      taskAdditions.set(normalizeTaskTitleForMatch(taskAdditionTitle), {
        title: taskAdditionTitle,
        note: segment,
        assigneeDisplay: assignmentDisplayFromSegment(segment),
      });
      continue;
    }

    const taskRemoval = taskRemovalFromSegment(segment);
    if (taskRemoval) {
      taskRemovals.set(
        taskRemoval.key ?? normalizeTaskTitleForMatch(taskRemoval.title),
        {
          ...taskRemoval,
          note: segment,
        },
      );
      continue;
    }

    const explicitStatus = statusFromSegment(segment);
    const assigneeDisplay = assignmentDisplayFromSegment(segment);
    for (const { key, patterns } of TASK_KEY_ALIASES) {
      if (patterns.some((pattern) => pattern.test(segment))) {
        if (explicitStatus) {
          taskStatusUpdates.set(key, {
            key,
            status: explicitStatus,
            note: segment,
          });
          if (explicitStatus === "completed") {
            completedTaskKeys.add(key);
          }
        }
        if (assigneeDisplay && ASSIGNMENT_WORDS.test(segment)) {
          taskAssignments.set(key, {
            key,
            assigneeDisplay,
            note: segment,
          });
        }
      }
    }
  }

  if (/\btax exemption forms?\b/i.test(content) && DONE_WORDS.test(content)) {
    facts.taxExemptionFormReceived = true;
  }

  return {
    facts: compactObject(facts) as CustomerOnboardingSourceInput,
    completedTaskKeys: [...completedTaskKeys],
    taskStatusUpdates: [...taskStatusUpdates.values()],
    taskAssignments: [...taskAssignments.values()],
    taskAdditions: [...taskAdditions.values()],
    taskRemovals: [...taskRemovals.values()],
    statusRequest: isStatusRequest(whole),
    assignmentRequest: isAssignmentRequest(whole),
    assignmentTaskKey: taskKeyFromContent(whole),
  };
}

export function shouldDispatchAgentForCustomerOnboardingMessage(
  content: string,
): boolean {
  const extracted = extractCustomerOnboardingChatUpdate(content);
  return (
    EMAIL_DELIVERY_REQUEST.test(content) &&
    (extracted.statusRequest || extracted.assignmentRequest)
  );
}

function hasCustomerOnboardingSignal(
  extracted: ReturnType<typeof extractCustomerOnboardingChatUpdate>,
): boolean {
  return (
    Object.keys(extracted.facts).length > 0 ||
    extracted.completedTaskKeys.length > 0 ||
    extracted.taskStatusUpdates.length > 0 ||
    extracted.taskAssignments.length > 0 ||
    extracted.taskAdditions.length > 0 ||
    extracted.taskRemovals.length > 0 ||
    extracted.statusRequest ||
    extracted.assignmentRequest
  );
}

function mergeOnboardingFacts(
  previousFacts: JsonRecord,
  extractedFacts: CustomerOnboardingSourceInput,
): CustomerOnboardingSourceInput {
  const raw = objectRecord(previousFacts.raw);
  const base = compactObject({
    ...raw,
    event: previousFacts.event,
    opportunityId: previousFacts.opportunityId,
    opportunityUrl: previousFacts.opportunityUrl,
    customerId: previousFacts.customerId,
    customerName: previousFacts.customerName,
    companyName: previousFacts.companyName,
    salesRep: previousFacts.salesRep,
    contacts: previousFacts.contacts,
    dealValue: previousFacts.dealValue,
    productPlan: previousFacts.productPlan,
    closeDate: previousFacts.closeDate,
    occurredAt: previousFacts.occurredAt,
    notes: previousFacts.notes,
    documents: previousFacts.documents,
    links: previousFacts.links,
    specialRequirements: previousFacts.specialRequirements,
    primaryContact: previousFacts.primaryContact,
    accountsPayableContact: previousFacts.accountsPayableContact,
    billingAddress: previousFacts.billingAddress,
    shippingAddress: previousFacts.shippingAddress,
    billingSameAsShipping: previousFacts.billingSameAsShipping,
    purchaseOrderNumber: previousFacts.purchaseOrderNumber,
    invoiceDeliveryMethod: previousFacts.invoiceDeliveryMethod,
    taxExempt: previousFacts.taxExempt,
    taxExemptionType: previousFacts.taxExemptionType,
    taxExemptionFormReceived: previousFacts.taxExemptionFormReceived,
    taxExemptionFormLocation: previousFacts.taxExemptionFormLocation,
    creditTermsRequested: previousFacts.creditTermsRequested,
    requestedTerms: previousFacts.requestedTerms,
    estimatedFirstOrderValue: previousFacts.estimatedFirstOrderValue,
    creditApprovalNotes: previousFacts.creditApprovalNotes,
    docusignRecipient: previousFacts.docusignRecipient,
    contractLink: previousFacts.contractLink,
    dunAndBradstreetId: previousFacts.dunAndBradstreetId,
    compliancePortal: previousFacts.compliancePortal,
    p21CustomerId: previousFacts.p21CustomerId,
    taxCode: previousFacts.taxCode,
    salesTerritory: previousFacts.salesTerritory,
    shippingMethod: previousFacts.shippingMethod,
    freightTerms: previousFacts.freightTerms,
    accountSetupBlockers: previousFacts.accountSetupBlockers,
  });

  return compactObject({
    ...base,
    ...extractedFacts,
    shippingAddress:
      extractedFacts.billingSameAsShipping === true
        ? null
        : (extractedFacts.shippingAddress ?? base.shippingAddress),
  }) as CustomerOnboardingSourceInput;
}

function buildUpdatedThreadMetadata(input: {
  current: JsonRecord;
  normalized: NormalizedCustomerOnboardingSource;
  extracted: ReturnType<typeof extractCustomerOnboardingChatUpdate>;
  updatedAt: Date;
  updatedByUserId: string | null;
}): JsonRecord {
  const onboarding = objectRecord(input.current.customerOnboarding);
  return compactObject({
    ...input.current,
    customerOnboarding: compactObject({
      ...onboarding,
      missingFields: input.normalized.missingFields,
      facts: input.normalized,
      humanInput:
        input.normalized.missingFields.length > 0
          ? onboarding.humanInput
          : null,
      lastChatUpdate: {
        extractedFacts: input.extracted.facts,
        completedTaskKeys: input.extracted.completedTaskKeys,
        taskAssignments: input.extracted.taskAssignments,
        taskAdditions: input.extracted.taskAdditions,
        taskRemovals: input.extracted.taskRemovals,
        updatedAt: input.updatedAt.toISOString(),
        updatedByUserId: input.updatedByUserId,
      },
    }),
  });
}

function taskAdditionTitleFromSegment(segment: string): string | null {
  if (!ADD_TASK_WORDS.test(segment)) return null;
  const patterns = [
    /\b(?:add|create|new)\s+(?:a\s+)?(?:new\s+)?(?:task|checklist item|todo|to-do)(?:\s+(?:to|for|on)\s+(?:the\s+)?(?:thread|checklist|tasklist|task list))?\s*(?::|-|called|named)?\s*(.+)$/i,
    /\b(?:add|put)\s+(.+?)\s+(?:to|on)\s+(?:the\s+)?(?:thread|checklist|tasklist|task list)\b/i,
    /\b(?:we\s+need|need)\s+(?:a\s+)?(?:task|checklist item)\s+(?:for|to)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const title = cleanTaskMutationTitle(segment.match(pattern)?.[1]);
    if (title) return title;
  }
  return null;
}

function foldContinuationTaskMutations(segments: string[]): string[] {
  const folded: string[] = [];
  for (let index = 0; index < segments.length; index += 1) {
    const segment = segments[index]!;
    const next = segments[index + 1];
    if (next && /:\s*$/.test(segment) && taskMutationIntro(segment)) {
      folded.push(`${segment} ${next}`);
      index += 1;
    } else {
      folded.push(segment);
    }
  }
  return folded;
}

function taskMutationIntro(segment: string): boolean {
  return ADD_TASK_WORDS.test(segment) || REMOVE_TASK_WORDS.test(segment);
}

function taskCommandFromPrefixedSegment(segment: string):
  | {
      type: "removal";
      title: string;
      key: string | null;
    }
  | {
      type: "status";
      title: string;
      key: string;
      status: LinkedTaskStatus;
    }
  | {
      type: "assignment";
      title: string;
      key: string;
      assigneeDisplay: string;
    }
  | null {
  const match = segment.match(/^(.+?)\s*:\s*(.+)$/);
  const rawTitle = match?.[1]?.trim();
  if (rawTitle && taskMutationIntro(rawTitle)) return null;
  const title = cleanTaskMutationTitle(rawTitle);
  const command = match?.[2]?.trim();
  if (!title || !command) return null;
  if (taskMutationIntro(title)) return null;

  const knownKey = taskKeyFromPrefilledTitle(title);
  if (REMOVE_COMMAND_WORDS.test(command)) {
    return {
      type: "removal",
      title,
      key: knownKey,
    };
  }

  const assigneeDisplay = assignmentDisplayFromSegment(command);
  if (assigneeDisplay && ASSIGNMENT_WORDS.test(command)) {
    return {
      type: "assignment",
      title,
      key: knownKey ?? customChecklistItemKey(title),
      assigneeDisplay,
    };
  }

  const status = statusFromSegment(command);
  if (!status) return null;
  return {
    type: "status",
    title,
    key: knownKey ?? customChecklistItemKey(title),
    status,
  };
}

function taskRemovalFromSegment(segment: string): {
  title: string;
  key: string | null;
} | null {
  if (!REMOVE_TASK_WORDS.test(segment)) return null;
  const key = taskKeyFromContent(segment);
  const patterns = [
    /\b(?:remove|delete|drop)\s+(?:the\s+)?(?:task|checklist item|todo|to-do)?\s*(?::|-|called|named)?\s*(.+?)(?:\s+from\s+(?:the\s+)?(?:thread|checklist|tasklist|task list))?$/i,
    /\b(?:remove|delete|drop)\s+(.+)$/i,
  ];
  for (const pattern of patterns) {
    const title = cleanTaskMutationTitle(segment.match(pattern)?.[1]);
    if (title) return { title, key };
  }
  return key ? { title: key, key } : null;
}

function taskKeyFromPrefilledTitle(title: string): string | null {
  const normalized = normalizeTaskTitleForMatch(title);
  const exactAliases: Array<[string, RegExp[]]> = [
    [
      "dun_and_bradstreet_check",
      [
        /\b(?:check\s+)?(?:dun\s+(?:and|&)\s+bradstreet|d&b|dnb)(?:\s+information)?\b/i,
      ],
    ],
    ["tax_exemption_forms", [/\b(?:collect\s+)?tax exemption forms?\b/i]],
    ["credit_check", [/\b(?:run\s+)?credit check\b/i, /\bcredit review\b/i]],
    [
      "docusign_package",
      [/\b(?:send and receive\s+)?docusign package\b/i, /\border form\b/i],
    ],
    [
      "p21_customer_setup",
      [
        /\benter customer information into p21\b/i,
        /\bp21 customer setup\b/i,
        /\bcustomer setup\b/i,
      ],
    ],
    [
      "missing_onboarding_information",
      [
        /\bresolve missing onboarding information\b/i,
        /\bmissing onboarding information\b/i,
        /\bmissing intake\b/i,
      ],
    ],
    [
      "final_onboarding_review",
      [/\bcomplete final onboarding review\b/i, /\bfinal onboarding review\b/i],
    ],
  ];

  for (const [key, patterns] of exactAliases) {
    if (patterns.some((pattern) => pattern.test(normalized))) return key;
  }
  return null;
}

function cleanTaskMutationTitle(value: string | undefined): string | null {
  const title = value
    ?.replace(
      /\bfrom\s+(?:the\s+)?(?:thread|checklist|tasklist|task list)\b/gi,
      "",
    )
    .replace(
      /\s*,?\s*@[^,.;:]+?\s+\b(?:will|is|was|can|should|shall|would|could|going|handling|handle|handles|handled|assigned|owns?|responsible|taking|take)\b.*$/i,
      "",
    )
    .replace(
      /\s*,?\s*(?:assign(?:ed)?|owner|owned|handled|handle|take|taking)\s+(?:it\s+|this\s+|the\s+task\s+)?(?:to|by)?\s*(?:the\s+)?(?:agent|thinkwork|computer)\b.*$/i,
      "",
    )
    .replace(/\b(?:task|checklist item|todo|to-do)$/i, "")
    .replace(/^["'“”‘’\s]+|["'“”‘’\s.?!]+$/g, "")
    .replace(/\s+/g, " ")
    .trim();
  if (!title || isGenericTaskTarget(title)) return null;
  return title;
}

function isGenericTaskTarget(value: string): boolean {
  return /^(?:task|tasks|checklist|checklist item|todo|to-do|tasklist|task list)$/i.test(
    value.trim(),
  );
}

function customChecklistItemKey(title: string): string {
  const slug = normalizeTaskTitleForMatch(title)
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "");
  return `custom_${slug || "task"}`;
}

function findTaskByTitle(
  tasks: Array<typeof linkedTasks.$inferSelect>,
  title: string,
) {
  const needle = normalizeTaskTitleForMatch(title);
  return tasks.find((task) => taskTitleMatches(task, needle));
}

function findRemovedCustomTaskByTitle(
  tasks: Array<typeof linkedTasks.$inferSelect>,
  title: string,
) {
  const needle = normalizeTaskTitleForMatch(title);
  return tasks.find((task) => {
    const metadata = objectRecord(task.metadata);
    return (
      objectRecord(metadata.nativeChecklist).removedAt &&
      metadata.customChecklistTask === true &&
      taskTitleMatches(task, needle)
    );
  });
}

function findTaskForRemoval(
  tasks: Array<typeof linkedTasks.$inferSelect>,
  removal: { title: string; key: string | null },
) {
  if (removal.key) {
    const task = tasks.find(
      (row) =>
        stringValue(objectRecord(row.metadata).checklistItemKey) ===
        removal.key,
    );
    if (task) return task;
  }
  return findTaskByTitle(tasks, removal.title);
}

function taskTitleMatches(
  task: typeof linkedTasks.$inferSelect,
  normalizedTitle: string,
): boolean {
  const title = normalizeTaskTitleForMatch(task.title);
  const cleanTitle = normalizeTaskTitleForMatch(
    cleanChecklistTaskTitle(task.title),
  );
  return (
    title === normalizedTitle ||
    cleanTitle === normalizedTitle ||
    title.includes(normalizedTitle) ||
    normalizedTitle.includes(cleanTitle)
  );
}

function normalizeTaskTitleForMatch(value: string): string {
  return value
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

function isRemovedChecklistTask(
  task: typeof linkedTasks.$inferSelect,
): boolean {
  return Boolean(
    objectRecord(objectRecord(task.metadata).nativeChecklist).removedAt,
  );
}

function markChecklistTaskRemoved(input: {
  current: unknown;
  note: string;
  updatedAt: Date;
  updatedByUserId: string | null;
}) {
  const metadata = objectRecord(input.current);
  const nativeChecklist = objectRecord(metadata.nativeChecklist);
  return compactObject({
    ...metadata,
    nativeChecklist: compactObject({
      ...nativeChecklist,
      removedAt: input.updatedAt.toISOString(),
      removedByUserId: input.updatedByUserId,
      removedNote: input.note,
      lastStatusNote: input.note,
      lastStatusMetadata: {
        source: "customer_onboarding_chat_update",
        removed: true,
      },
      lastStatusUpdatedAt: input.updatedAt.toISOString(),
      lastStatusUpdatedByUserId: input.updatedByUserId,
    }),
  });
}

function restoreRemovedChecklistMetadata(input: {
  current: unknown;
  note: string;
  updatedAt: Date;
  updatedByUserId: string | null;
}) {
  const metadata = objectRecord(input.current);
  const nativeChecklist = objectRecord(metadata.nativeChecklist);
  const { removedAt, removedByUserId, removedNote, ...activeNativeChecklist } =
    nativeChecklist;
  void removedAt;
  void removedByUserId;
  void removedNote;

  return compactObject({
    ...metadata,
    nativeChecklist: compactObject({
      ...activeNativeChecklist,
      restoredAt: input.updatedAt.toISOString(),
      restoredByUserId: input.updatedByUserId,
      restoredNote: input.note,
      lastStatusNote: input.note,
      lastStatusMetadata: {
        source: "customer_onboarding_chat_update",
        restored: true,
      },
      lastStatusUpdatedAt: input.updatedAt.toISOString(),
      lastStatusUpdatedByUserId: input.updatedByUserId,
    }),
  });
}

function desiredStatusForTask(input: {
  checklistItemKey: string;
  currentStatus: LinkedTaskStatus;
  normalized: NormalizedCustomerOnboardingSource;
  completedTaskKeys: string[];
  explicitStatus?: LinkedTaskStatus;
}): LinkedTaskStatus {
  if (input.explicitStatus) return input.explicitStatus;
  if (input.completedTaskKeys.includes(input.checklistItemKey)) {
    return "completed";
  }
  if (input.checklistItemKey === "missing_onboarding_information") {
    return input.normalized.missingFields.length === 0 ? "completed" : "todo";
  }
  if (input.checklistItemKey === "credit_check") {
    return input.normalized.creditTermsRequested
      ? activeStatus(input.currentStatus)
      : "not_applicable";
  }
  if (input.checklistItemKey === "tax_exemption_forms") {
    return input.normalized.taxExempt
      ? activeStatus(input.currentStatus)
      : "not_applicable";
  }
  return input.currentStatus;
}

function desiredRequiredForTask(input: {
  checklistItemKey: string;
  currentRequired: boolean;
  normalized: NormalizedCustomerOnboardingSource;
}): boolean {
  if (input.checklistItemKey === "credit_check") {
    return input.normalized.creditTermsRequested === true;
  }
  if (input.checklistItemKey === "tax_exemption_forms") {
    return input.normalized.taxExempt === true;
  }
  if (input.checklistItemKey === "missing_onboarding_information") {
    return input.normalized.missingFields.length > 0;
  }
  return input.currentRequired;
}

function statusFromSegment(segment: string): LinkedTaskStatus | null {
  if (NOT_APPLICABLE_WORDS.test(segment)) return "not_applicable";
  if (BLOCKED_WORDS.test(segment)) return "blocked";
  if (
    TASK_KEY_ALIASES.find((task) => task.key === "credit_check")?.patterns.some(
      (pattern) => pattern.test(segment),
    ) &&
    CREDIT_APPROVED_WORDS.test(segment)
  ) {
    return "completed";
  }
  if (DONE_WORDS.test(segment)) return "completed";
  if (IN_PROGRESS_WORDS.test(segment)) return "in_progress";
  return null;
}

const ASSIGNMENT_WORDS =
  /\b(?:handle|handling|handled|assigned|assign|owns?|owner|responsible|take|taking)\b/i;

function isCreditEvidenceSegment(segment: string): boolean {
  return (
    CREDIT_EVIDENCE_WORDS.test(segment) ||
    (/\bapproved\s+(?:for|at)\b/i.test(segment) && MONEY_AMOUNT.test(segment))
  );
}

function assignmentDisplayFromSegment(segment: string): string | null {
  const match = segment.match(
    /@([A-Za-z][A-Za-z'.-]*(?:\s+[A-Za-z][A-Za-z'.-]*)?)/,
  );
  const mentionedAssignee = match?.[1]?.trim();
  if (mentionedAssignee) return mentionedAssignee;
  if (
    ASSIGNMENT_WORDS.test(segment) &&
    /\b(?:agent|thinkwork|computer)\b/i.test(segment)
  ) {
    return "Agent";
  }
  return null;
}

function isStatusRequest(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (STATUS_REQUEST.test(trimmed)) return true;
  return /^(?:status|progress|checklist)\??$/i.test(trimmed);
}

function isAssignmentRequest(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  return ASSIGNMENT_REQUEST.test(trimmed);
}

function taskKeyFromContent(content: string): string | null {
  for (const { key, patterns } of TASK_KEY_ALIASES) {
    if (patterns.some((pattern) => pattern.test(content))) return key;
  }
  return null;
}

function activeStatus(currentStatus: LinkedTaskStatus): LinkedTaskStatus {
  return currentStatus === "not_applicable" || currentStatus === "unknown"
    ? "todo"
    : currentStatus;
}

function buildAssistantSummary(input: {
  normalized: NormalizedCustomerOnboardingSource;
  statusChanges: CustomerOnboardingChatUpdateResult["statusChanges"];
  completedTaskKeys: string[];
  assignmentChanges: CustomerOnboardingChatUpdateResult["assignmentChanges"];
  addedTasks: CustomerOnboardingChatUpdateResult["addedTasks"];
  removedTasks: CustomerOnboardingChatUpdateResult["removedTasks"];
  unmatchedTaskRemovals: CustomerOnboardingChatUpdateResult["unmatchedTaskRemovals"];
}): string {
  const lines = ["Captured the onboarding update and refreshed Progress."];
  if (input.normalized.missingFields.length === 0) {
    lines.push("All required intake fields are now captured.");
  } else {
    lines.push(`Still missing: ${input.normalized.missingFields.join(", ")}.`);
  }
  if (input.statusChanges.length > 0) {
    lines.push("Checklist updates:");
    for (const change of input.statusChanges) {
      lines.push(
        `- ${change.title}: ${change.previousStatus.replace(/_/g, " ")} -> ${change.nextStatus.replace(/_/g, " ")}`,
      );
    }
  } else if (input.completedTaskKeys.length > 0) {
    lines.push("I did not find matching ThinkWork checklist rows to update.");
  }
  if (input.assignmentChanges.length > 0) {
    lines.push("Assignment updates:");
    for (const change of input.assignmentChanges) {
      lines.push(`- ${change.title}: ${change.nextAssignee}`);
    }
  }
  if (input.addedTasks.length > 0) {
    lines.push("Added checklist tasks:");
    for (const task of input.addedTasks) {
      lines.push(`- ${task.title}`);
    }
  }
  if (input.removedTasks.length > 0) {
    lines.push("Removed checklist tasks:");
    for (const task of input.removedTasks) {
      lines.push(`- ${task.title}`);
    }
  }
  if (input.unmatchedTaskRemovals.length > 0) {
    lines.push("I did not find matching checklist tasks to remove:");
    for (const task of input.unmatchedTaskRemovals) {
      lines.push(`- ${task.title}`);
    }
  }
  return lines.join("\n");
}

function buildCustomerOnboardingOnlySummary(
  normalized: NormalizedCustomerOnboardingSource,
): string {
  const lines = [
    "I’m tracking this onboarding in ThinkWork. No external systems are needed for this workflow.",
  ];
  if (normalized.missingFields.length > 0) {
    lines.push(`Still missing: ${normalized.missingFields.join(", ")}.`);
    lines.push(
      "Reply with intake answers, task updates, assignments, or ask for status.",
    );
  } else {
    lines.push(
      "All intake fields are captured. Reply with task updates or assignments.",
    );
  }
  return lines.join("\n");
}

function buildAssignmentStatusSummary(input: {
  taskRows: Array<typeof linkedTasks.$inferSelect>;
  statusChanges: CustomerOnboardingChatUpdateResult["statusChanges"];
  assignmentChanges: CustomerOnboardingChatUpdateResult["assignmentChanges"];
  requestedTaskKey: string | null;
}): string {
  const statusChangesByKey = new Map(
    input.statusChanges.map((change) => [
      change.checklistItemKey,
      change.nextStatus,
    ]),
  );
  const assignmentChangesByKey = new Map(
    input.assignmentChanges.map((change) => [
      change.checklistItemKey,
      change.nextAssignee,
    ]),
  );
  const tasks = input.taskRows
    .map((task) => {
      const key = stringValue(objectRecord(task.metadata).checklistItemKey);
      return {
        key,
        title: cleanChecklistTaskTitle(task.title),
        status:
          statusChangesByKey.get(key ?? "") ??
          (task.status as LinkedTaskStatus),
        owner:
          assignmentChangesByKey.get(key ?? "") ??
          stringValue(task.assignee_display) ??
          formatStatusLabel(stringValue(task.role_key)) ??
          "Unassigned",
      };
    })
    .filter(
      (task) => !input.requestedTaskKey || task.key === input.requestedTaskKey,
    );

  if (tasks.length === 0) {
    return input.requestedTaskKey
      ? "I don’t see that task in this onboarding checklist yet."
      : "I don’t see any onboarding checklist task assignments yet.";
  }

  if (tasks.length === 1) {
    const task = tasks[0];
    return `${task.title} is assigned to ${task.owner}. Status: ${formatStatusLabel(task.status) ?? task.status}.`;
  }

  return [
    "Current onboarding task assignments:",
    ...tasks.map((task) => `- ${task.title}: ${task.owner}`),
  ].join("\n");
}

function normalizeMoneyAmount(value: string): string {
  return value.replace(/\s+/g, "");
}

function cleanChecklistTaskTitle(title: string): string {
  return title.replace(/\s+-\s+.+$/u, "").trim() || title;
}

function buildProgressStatusSummary(input: {
  normalized: NormalizedCustomerOnboardingSource;
  taskRows: Array<typeof linkedTasks.$inferSelect>;
  statusChanges: CustomerOnboardingChatUpdateResult["statusChanges"];
}): string {
  const statusChangesByKey = new Map(
    input.statusChanges.map((change) => [
      change.checklistItemKey,
      change.nextStatus,
    ]),
  );
  const tasks = input.taskRows.map((task) => ({
    title: task.title,
    status:
      statusChangesByKey.get(
        stringValue(objectRecord(task.metadata).checklistItemKey) ?? "",
      ) ?? (task.status as LinkedTaskStatus),
    required: task.required !== false,
    blocked: task.blocked || task.status === "blocked",
    owner:
      stringValue(task.assignee_display) ??
      formatStatusLabel(stringValue(task.role_key)) ??
      "Unassigned",
  }));
  const requiredTasks = tasks.filter(
    (task) => task.required && task.status !== "not_applicable",
  );
  const completed = requiredTasks.filter(
    (task) => task.status === "completed",
  ).length;
  const total = requiredTasks.length;
  const blockers = tasks.filter((task) => task.blocked);
  const waiting = requiredTasks.filter((task) =>
    ["todo", "in_progress", "blocked", "unknown"].includes(task.status),
  );

  const lines = [
    `Progress: ${completed}/${total} required onboarding tasks complete.`,
  ];

  if (input.normalized.missingFields.length > 0) {
    lines.push(`Missing intake: ${input.normalized.missingFields.join(", ")}.`);
  }
  if (input.statusChanges.length > 0) {
    lines.push("Just updated:");
    for (const change of input.statusChanges) {
      lines.push(
        `- ${change.title}: ${formatStatusLabel(change.previousStatus)} -> ${formatStatusLabel(change.nextStatus)}`,
      );
    }
  }
  if (blockers.length > 0) {
    lines.push("Blockers:");
    for (const task of blockers) {
      lines.push(`- ${task.title} (${task.owner})`);
    }
  }
  if (waiting.length > 0) {
    lines.push("Still waiting on:");
    for (const task of waiting) {
      lines.push(
        `- ${task.title}: ${formatStatusLabel(task.status)} (${task.owner})`,
      );
    }
  } else if (total > 0) {
    lines.push("All required onboarding tasks are complete.");
  }

  return lines.join("\n");
}

function personAfterLabel(segment: string) {
  const value = valueAfterLabel(segment);
  const email = value.match(/[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/i)?.[0];
  const name = value
    .replace(email ?? "", "")
    .replace(/[<>,]/g, " ")
    .trim()
    .replace(/\s+/g, " ");
  return compactObject({ name: name || null, email });
}

function valueAfterLabel(segment: string): string {
  return segment
    .replace(/^[^:]*:\s*/u, "")
    .replace(
      /^(?:here is the missing onboarding data:\s*)?(?:opportunity link|opportunity url|quote link|sales owner|sales rep|primary customer contact|primary contact|accounts payable contact|ap contact|estimated value|estimated deal value|estimated first-order value|deal value|product plan|product class|customer class|target onboarding date|target close date|close date|contract link|order-form link|order form link|billing address|shipping address|tax exempt|agricultural\/sales-tax exempt|credit terms requested|credit terms|docusign recipient|dun\s*&\s*bradstreet id|d&b id)\s*/iu,
      "",
    )
    .trim()
    .replace(/[.。]\s*$/u, "");
}

function booleanFromText(value: string): boolean | null {
  const normalized = value.toLowerCase();
  if (
    /\b(?:no|false|not requested|does not want|doesn't want)\b/.test(normalized)
  ) {
    return false;
  }
  if (/\b(?:yes|true|requested|needed|wants?|does want)\b/.test(normalized)) {
    return true;
  }
  return null;
}

function firstUrl(value: string): string | null {
  return value.match(/https?:\/\/[^\s;,)]+/i)?.[0] ?? null;
}

function labeledUrl(content: string, label: RegExp): string | null {
  const match = content.match(
    new RegExp(`${label.source}[^\\n;]*?(https?:\\/\\/[^\\s;,)]+)`, "i"),
  );
  return match?.[1] ?? null;
}

function formatStatusLabel(value?: string | null): string | null {
  const label = String(value ?? "")
    .trim()
    .toLowerCase()
    .split(/[_\s-]+/)
    .filter(Boolean)
    .map((part) => part.charAt(0).toUpperCase() + part.slice(1))
    .join(" ");
  return label || null;
}

function objectRecord(value: unknown): JsonRecord {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as JsonRecord)
    : {};
}

function compactObject(value: JsonRecord): JsonRecord {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
