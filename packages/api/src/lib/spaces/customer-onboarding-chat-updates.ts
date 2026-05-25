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
import type { LinkedTaskStatus } from "../linked-tasks/status.js";

interface ApplyCustomerOnboardingChatUpdateInput {
  tenantId: string;
  threadId: string;
  content: string;
  senderUserId?: string | null;
}

export interface CustomerOnboardingChatUpdateResult {
  handled: boolean;
  assistantMessageId: string | null;
  missingFields: string[];
  statusRequest: boolean;
  statusChanges: Array<{
    checklistItemKey: string;
    title: string;
    previousStatus: LinkedTaskStatus;
    nextStatus: LinkedTaskStatus;
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
    patterns: [/\bcredit check\b/i, /\bcredit review\b/i],
  },
  {
    key: "docusign_package",
    patterns: [/\bdocusign\b/i, /\bcontract\b/i, /\border form\b/i],
  },
  {
    key: "p21_customer_setup",
    patterns: [/\bp21\b/i],
  },
  {
    key: "final_onboarding_review",
    patterns: [/\bfinal onboarding review\b/i, /\bfinal review\b/i],
  },
];

const DONE_WORDS =
  /\b(?:done|complete|completed|checked|collected|received|signed|approved|entered|created|set up|setup)\b/i;

const STATUS_REQUEST =
  /\b(?:what(?:'s| is)?|show|give me|current|latest)?\s*(?:the\s+)?(?:onboarding\s+)?(?:status|progress|checklist)\b/i;

const BLOCKED_WORDS =
  /\b(?:blocked|blocker|stuck|waiting on|waiting for|hold|on hold|cannot|can't)\b/i;
const IN_PROGRESS_WORDS =
  /\b(?:sent|started|working|in progress|pending|waiting on|waiting for|submitted)\b/i;
const NOT_APPLICABLE_WORDS =
  /\b(?:not applicable|n\/a|na|not needed|skip|skipped|waived)\b/i;

export async function applyCustomerOnboardingChatUpdate(
  input: ApplyCustomerOnboardingChatUpdateInput,
): Promise<CustomerOnboardingChatUpdateResult | null> {
  const db = getDb();
  const extracted = extractCustomerOnboardingChatUpdate(input.content);
  if (
    Object.keys(extracted.facts).length === 0 &&
    extracted.completedTaskKeys.length === 0 &&
    extracted.taskStatusUpdates.length === 0 &&
    !extracted.statusRequest
  ) {
    return null;
  }

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

  const previousFacts = objectRecord(onboarding.facts);
  const mergedOpportunity = mergeOnboardingFacts(
    previousFacts,
    extracted.facts,
  );
  const normalized = normalizeCustomerOnboardingSource(mergedOpportunity);
  const now = new Date();

  return await db.transaction(async (tx) => {
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

    const statusChanges: CustomerOnboardingChatUpdateResult["statusChanges"] =
      [];
    const explicitStatusByKey = new Map(
      extracted.taskStatusUpdates.map((update) => [update.key, update]),
    );
    for (const task of taskRows) {
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
      if (nextStatus === previousStatus) continue;

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
        }),
      });

      await tx
        .update(linkedTasks)
        .set({
          status: nextStatus,
          blocked: nextStatus === "blocked",
          sync_status: "synced",
          last_synced_at: now,
          metadata: nextTaskMetadata,
          updated_at: now,
        })
        .where(eq(linkedTasks.id, task.id));

      await tx.insert(linkedTaskEvents).values({
        tenant_id: input.tenantId,
        linked_task_id: task.id,
        space_id: task.space_id,
        thread_id: input.threadId,
        provider: "thinkwork",
        event_type: nextStatus === "completed" ? "completed" : "status_changed",
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

    const assistantContent = extracted.statusRequest
      ? buildProgressStatusSummary({ normalized, taskRows, statusChanges })
      : buildAssistantSummary({
          normalized,
          statusChanges,
          completedTaskKeys: extracted.completedTaskKeys,
        });
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
          missingFields: normalized.missingFields,
          statusChanges,
        },
        created_at: now,
      })
      .returning({ id: messages.id });

    return {
      handled: true,
      assistantMessageId: assistantMessage?.id ?? null,
      missingFields: normalized.missingFields,
      statusRequest: extracted.statusRequest,
      statusChanges,
    };
  });
}

export function extractCustomerOnboardingChatUpdate(content: string): {
  facts: CustomerOnboardingSourceInput;
  completedTaskKeys: string[];
  taskStatusUpdates: Array<{
    key: string;
    status: LinkedTaskStatus;
    note: string;
  }>;
  statusRequest: boolean;
} {
  const facts: CustomerOnboardingSourceInput = {};
  const segments = content
    .split(/[\n;]+/g)
    .map((segment) => segment.trim())
    .filter(Boolean);
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
  for (const segment of segments) {
    const explicitStatus = statusFromSegment(segment);
    if (!explicitStatus) continue;
    for (const { key, patterns } of TASK_KEY_ALIASES) {
      if (patterns.some((pattern) => pattern.test(segment))) {
        taskStatusUpdates.set(key, {
          key,
          status: explicitStatus,
          note: segment,
        });
        if (explicitStatus === "completed") {
          completedTaskKeys.add(key);
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
    statusRequest: isStatusRequest(whole),
  };
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
        updatedAt: input.updatedAt.toISOString(),
        updatedByUserId: input.updatedByUserId,
      },
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

function statusFromSegment(segment: string): LinkedTaskStatus | null {
  if (NOT_APPLICABLE_WORDS.test(segment)) return "not_applicable";
  if (DONE_WORDS.test(segment)) return "completed";
  if (BLOCKED_WORDS.test(segment)) return "blocked";
  if (IN_PROGRESS_WORDS.test(segment)) return "in_progress";
  return null;
}

function isStatusRequest(content: string): boolean {
  const trimmed = content.trim();
  if (!trimmed) return false;
  if (STATUS_REQUEST.test(trimmed)) return true;
  return /^(?:status|progress|checklist)\??$/i.test(trimmed);
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
}): string {
  const lines = ["Captured the onboarding update."];
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
  return lines.join("\n");
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
