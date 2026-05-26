import { and, asc, eq, sql } from "drizzle-orm";
import { getDb } from "@thinkwork/database-pg";
import {
  linkedTaskEvents,
  linkedTasks,
  messages,
  spaceChecklistItems,
  spaceChecklistTemplates,
  spaceIntegrations,
  spaces,
  tenants,
  threads,
  threadParticipants,
} from "@thinkwork/database-pg/schema";

import {
  type CreateLastMileTaskInput,
  type LastMileAdapterResult,
  type LastMileTaskSnapshot,
  type LastMileProviderError,
} from "../lastmile/tasks-adapter.js";
import type {
  LinkedTaskStatus,
  LinkedTaskSyncStatus,
} from "../linked-tasks/status.js";
import {
  createCoordinatorAgentService,
  type CoordinatorAgentService,
} from "./coordinator-agent.js";
import {
  CUSTOMER_ONBOARDING_CHECKLIST_ITEMS,
  CUSTOMER_ONBOARDING_CHECKLIST_KEY,
  buildCustomerOnboardingChecklistConfig,
} from "./customer-onboarding-seed.js";
import { refreshCustomerOnboardingProgressMarkdownSafely } from "./customer-onboarding-progress-md.js";

export const CUSTOMER_ONBOARDING_TEMPLATE_KEY = "customer_onboarding";

export type CustomerOnboardingStartSource = "webhook" | "manual";

export interface CustomerOnboardingSourceInput {
  event?: string | null;
  opportunityId?: string | null;
  opportunityUrl?: string | null;
  customerId?: string | null;
  customerName?: string | null;
  companyName?: string | null;
  salesRep?: string | CustomerOnboardingPerson | null;
  contacts?: unknown;
  dealValue?: string | number | null;
  product?: string | null;
  plan?: string | null;
  productPlan?: string | null;
  closeDate?: string | null;
  occurredAt?: string | null;
  notes?: string | null;
  documents?: unknown;
  links?: unknown;
  specialRequirements?: string | null;
  primaryContact?: unknown;
  accountsPayableContact?: unknown;
  billingAddress?: string | null;
  shippingAddress?: string | null;
  billingSameAsShipping?: boolean | string | null;
  purchaseOrderNumber?: string | null;
  invoiceDeliveryMethod?: string | null;
  taxExempt?: boolean | string | null;
  taxExemptionType?: string | null;
  taxExemptionFormReceived?: boolean | string | null;
  taxExemptionFormLocation?: string | null;
  creditTermsRequested?: boolean | string | null;
  requestedTerms?: string | null;
  estimatedFirstOrderValue?: string | number | null;
  creditApprovalNotes?: string | null;
  docusignRecipient?: unknown;
  contractLink?: string | null;
  dunAndBradstreetId?: string | null;
  compliancePortal?: string | null;
  p21CustomerId?: string | null;
  taxCode?: string | null;
  salesTerritory?: string | null;
  shippingMethod?: string | null;
  freightTerms?: string | null;
  accountSetupBlockers?: string | null;
  [key: string]: unknown;
}

export interface CustomerOnboardingPerson {
  id?: string | null;
  name?: string | null;
  email?: string | null;
}

export interface NormalizedCustomerOnboardingSource {
  event: string | null;
  opportunityId: string;
  opportunityUrl: string | null;
  customerId: string | null;
  customerName: string | null;
  companyName: string | null;
  salesRep: CustomerOnboardingPerson | null;
  contacts: CustomerOnboardingPerson[];
  dealValue: string | null;
  productPlan: string | null;
  closeDate: string | null;
  occurredAt: string | null;
  notes: string | null;
  documents: CustomerOnboardingLink[];
  links: CustomerOnboardingLink[];
  specialRequirements: string | null;
  primaryContact: CustomerOnboardingPerson | null;
  accountsPayableContact: CustomerOnboardingPerson | null;
  billingAddress: string | null;
  shippingAddress: string | null;
  billingSameAsShipping: boolean | null;
  purchaseOrderNumber: string | null;
  invoiceDeliveryMethod: string | null;
  taxExempt: boolean | null;
  taxExemptionType: string | null;
  taxExemptionFormReceived: boolean | null;
  taxExemptionFormLocation: string | null;
  creditTermsRequested: boolean | null;
  requestedTerms: string | null;
  estimatedFirstOrderValue: string | null;
  creditApprovalNotes: string | null;
  docusignRecipient: CustomerOnboardingPerson | null;
  contractLink: string | null;
  dunAndBradstreetId: string | null;
  compliancePortal: string | null;
  p21CustomerId: string | null;
  taxCode: string | null;
  salesTerritory: string | null;
  shippingMethod: string | null;
  freightTerms: string | null;
  accountSetupBlockers: string | null;
  missingFields: string[];
  raw: CustomerOnboardingSourceInput;
}

export interface CustomerOnboardingLink {
  title: string | null;
  url: string | null;
}

export interface CustomerOnboardingHumanInputRequest {
  skill: "human_question";
  channel: "thread";
  checklistItemKey: "missing_onboarding_information";
  prompt: string;
  questionCard: {
    _type: "question_card";
    schema: {
      id: "customer_onboarding_missing_intake";
      title: "Missing onboarding information";
      fields: CustomerOnboardingQuestionField[];
    };
  };
}

export interface CustomerOnboardingQuestionField {
  id: string;
  label: string;
  type: "text" | "textarea" | "boolean";
}

export interface StartCustomerOnboardingWorkflowInput {
  tenantId: string;
  spaceId?: string | null;
  source: CustomerOnboardingStartSource;
  opportunity: CustomerOnboardingSourceInput;
  startedBy?: {
    type: "user" | "system";
    id?: string | null;
  } | null;
}

export interface CustomerOnboardingWorkflowResult {
  thread: CustomerOnboardingThreadRef;
  idempotent: boolean;
  linkedTasks: CustomerOnboardingLinkedTaskResult[];
  missingFields: string[];
}

export interface CustomerOnboardingThreadRef {
  id: string;
  tenantId: string;
  spaceId: string | null;
  title: string;
  identifier: string | null;
  metadata: Record<string, unknown> | null;
}

export interface CustomerOnboardingLinkedTaskResult {
  checklistItemId: string;
  provider: "lastmile" | "thinkwork";
  title: string;
  externalTaskId: string;
  externalTaskUrl: string | null;
  status: LinkedTaskStatus;
  blocked: boolean;
  syncStatus: LinkedTaskSyncStatus;
  providerError?: LastMileProviderError;
}

interface PlannedChecklistItem {
  item: CustomerOnboardingChecklistItem;
  task: CustomerOnboardingLinkedTaskResult;
  required: boolean;
  assignee: {
    externalId: string | null;
    displayName: string | null;
  } | null;
  metadata: Record<string, unknown>;
}

export interface CustomerOnboardingWorkflowSpace {
  id: string;
  tenantId: string;
  name: string;
  prompt: string | null;
  config: Record<string, unknown> | null;
  checklistItems: CustomerOnboardingChecklistItem[];
  integration: CustomerOnboardingIntegration | null;
}

export interface CustomerOnboardingChecklistItem {
  id: string;
  key: string;
  title: string;
  description: string | null;
  roleKey: string | null;
  required: boolean;
  externalTaskTemplate: Record<string, unknown> | null;
}

export interface CustomerOnboardingIntegration {
  id: string;
  writebackPolicy: string;
  config: Record<string, unknown> | null;
}

export interface CreateCustomerOnboardingCaseInput {
  tenantId: string;
  space: CustomerOnboardingWorkflowSpace;
  title: string;
  channel: "webhook" | "manual";
  createdByType: "user" | "system";
  createdById: string | null;
  kickoffMessage: string;
  humanInput: CustomerOnboardingHumanInputRequest | null;
  metadata: Record<string, unknown>;
}

export interface CreateCustomerOnboardingLinkedTaskInput {
  tenantId: string;
  spaceId: string;
  threadId: string;
  checklistItem: CustomerOnboardingChecklistItem;
  task: CustomerOnboardingLinkedTaskResult;
  required: boolean;
  roleKey: string | null;
  assignee: {
    externalId: string | null;
    displayName: string | null;
  } | null;
  metadata: Record<string, unknown>;
}

export interface CustomerOnboardingWorkflowRepository {
  findSpace(input: {
    tenantId: string;
    spaceId?: string | null;
  }): Promise<CustomerOnboardingWorkflowSpace | null>;
  ensureNativeChecklist?(input: {
    tenantId: string;
    spaceId: string;
  }): Promise<void>;
  findExistingThread(input: {
    tenantId: string;
    spaceId: string;
    opportunityId: string;
  }): Promise<CustomerOnboardingThreadRef | null>;
  createCase(
    input: CreateCustomerOnboardingCaseInput,
  ): Promise<CustomerOnboardingThreadRef>;
  createLinkedTask(
    input: CreateCustomerOnboardingLinkedTaskInput,
  ): Promise<void>;
}

export interface LastMileTasksWorkflowAdapter {
  createTask(
    input: CreateLastMileTaskInput,
  ): Promise<LastMileAdapterResult<LastMileTaskSnapshot>>;
}

export interface CustomerOnboardingWorkflowDeps {
  repository?: CustomerOnboardingWorkflowRepository;
  taskAdapter?: LastMileTasksWorkflowAdapter;
  coordinator?: Pick<CoordinatorAgentService, "enqueueWakeup">;
  progressReporter?: {
    refresh(input: { tenantId: string; threadId: string }): Promise<unknown>;
  };
  now?: () => Date;
}

export class CustomerOnboardingWorkflowError extends Error {
  constructor(
    message: string,
    public readonly status: number,
    public readonly code: string,
  ) {
    super(message);
    this.name = "CustomerOnboardingWorkflowError";
  }
}

export async function startCustomerOnboardingWorkflow(
  input: StartCustomerOnboardingWorkflowInput,
  deps: CustomerOnboardingWorkflowDeps = {},
): Promise<CustomerOnboardingWorkflowResult> {
  const repository =
    deps.repository ?? new DrizzleCustomerOnboardingRepository();
  const progressReporter =
    deps.progressReporter ??
    (deps.repository
      ? null
      : { refresh: refreshCustomerOnboardingProgressMarkdownSafely });
  const taskAdapter =
    deps.taskAdapter ?? createUnavailableLastMileTaskAdapter();
  const coordinator = deps.coordinator ?? createCoordinatorAgentService();
  const normalized = normalizeCustomerOnboardingSource(input.opportunity);

  let space = await repository.findSpace({
    tenantId: input.tenantId,
    spaceId: input.spaceId,
  });
  if (!space) {
    throw new CustomerOnboardingWorkflowError(
      "Customer Onboarding Space not found",
      404,
      "CUSTOMER_ONBOARDING_SPACE_NOT_FOUND",
    );
  }
  if (
    space.checklistItems.length === 0 &&
    shouldUseNativeChecklist(input, space) &&
    repository.ensureNativeChecklist
  ) {
    await repository.ensureNativeChecklist({
      tenantId: input.tenantId,
      spaceId: space.id,
    });
    space = await repository.findSpace({
      tenantId: input.tenantId,
      spaceId: space.id,
    });
  }

  if (!space) {
    throw new CustomerOnboardingWorkflowError(
      "Customer Onboarding Space not found",
      404,
      "CUSTOMER_ONBOARDING_SPACE_NOT_FOUND",
    );
  }
  if (space.checklistItems.length === 0) {
    throw new CustomerOnboardingWorkflowError(
      "Customer Onboarding Space has no checklist items",
      409,
      "CUSTOMER_ONBOARDING_CHECKLIST_EMPTY",
    );
  }

  const existing = await repository.findExistingThread({
    tenantId: input.tenantId,
    spaceId: space.id,
    opportunityId: normalized.opportunityId,
  });
  if (existing) {
    await progressReporter?.refresh({
      tenantId: input.tenantId,
      threadId: existing.id,
    });
    return {
      thread: existing,
      idempotent: true,
      linkedTasks: [],
      missingFields: normalized.missingFields,
    };
  }

  const title = buildThreadTitle(normalized);
  const humanInput = buildHumanInputRequest(normalized);
  const metadata = buildWorkflowMetadata(
    normalized,
    input.source,
    space,
    humanInput,
  );
  const thread = await repository.createCase({
    tenantId: input.tenantId,
    space,
    title,
    channel: input.source === "webhook" ? "webhook" : "manual",
    createdByType: input.startedBy?.type ?? "system",
    createdById: input.startedBy?.id ?? null,
    kickoffMessage: buildKickoffMessage(normalized),
    humanInput,
    metadata,
  });

  const useNativeChecklist = shouldUseNativeChecklist(input, space);
  const checklistPlan = useNativeChecklist
    ? planNativeChecklistItems(space, thread.id, normalized)
    : await planExternalChecklistItems({
        input,
        space,
        threadId: thread.id,
        normalized,
        taskAdapter,
      });

  const linkedTaskResults = checklistPlan.map((planned) => planned.task);
  for (const planned of checklistPlan) {
    await repository.createLinkedTask({
      tenantId: input.tenantId,
      spaceId: space.id,
      threadId: thread.id,
      checklistItem: planned.item,
      task: planned.task,
      required: planned.required,
      roleKey: planned.item.roleKey,
      assignee: planned.assignee,
      metadata: planned.metadata,
    });
  }

  await progressReporter?.refresh({
    tenantId: input.tenantId,
    threadId: thread.id,
  });

  await coordinator.enqueueWakeup({
    tenantId: input.tenantId,
    spaceId: space.id,
    threadId: thread.id,
    reason: "kickoff_triage",
    idempotencyKey: `space-coordinator:${input.tenantId}:${thread.id}:kickoff_triage`,
    summary: useNativeChecklist
      ? `A new customer onboarding Thread was created with ${linkedTaskResults.length} ThinkWork checklist rows. Review missing facts, not-applicable items, and possible blockers.`
      : "A new customer onboarding Thread was created and checklist tasks were mirrored. Review missing facts, unassigned tasks, and possible blockers.",
    requestedBy: input.startedBy ?? { type: "system" },
  });

  return {
    thread,
    idempotent: false,
    linkedTasks: linkedTaskResults,
    missingFields: normalized.missingFields,
  };
}

export function normalizeCustomerOnboardingSource(
  payload: CustomerOnboardingSourceInput,
): NormalizedCustomerOnboardingSource {
  const opportunityId = stringValue(payload.opportunityId);
  if (!opportunityId) {
    throw new CustomerOnboardingWorkflowError(
      "opportunityId is required",
      400,
      "OPPORTUNITY_ID_REQUIRED",
    );
  }

  const customerName =
    stringValue(payload.customerName) ??
    stringValue(payload.companyName) ??
    stringValue(
      (payload.customer as Record<string, unknown> | undefined)?.name,
    );
  const companyName = stringValue(payload.companyName) ?? customerName;
  const customerId =
    stringValue(payload.customerId) ??
    stringValue((payload.customer as Record<string, unknown> | undefined)?.id);
  if (!customerId && !customerName) {
    throw new CustomerOnboardingWorkflowError(
      "customerId or customerName is required",
      400,
      "CUSTOMER_REQUIRED",
    );
  }

  const productPlan =
    stringValue(payload.productPlan) ??
    ([stringValue(payload.product), stringValue(payload.plan)]
      .filter(Boolean)
      .join(" / ") ||
      null);

  const normalized: NormalizedCustomerOnboardingSource = {
    event: stringValue(payload.event),
    opportunityId,
    opportunityUrl: stringValue(payload.opportunityUrl),
    customerId,
    customerName,
    companyName,
    salesRep: normalizePerson(payload.salesRep),
    contacts: normalizePeople(payload.contacts),
    dealValue:
      typeof payload.dealValue === "number"
        ? String(payload.dealValue)
        : stringValue(payload.dealValue),
    productPlan,
    closeDate: stringValue(payload.closeDate),
    occurredAt: stringValue(payload.occurredAt),
    notes: stringValue(payload.notes),
    documents: normalizeLinks(payload.documents),
    links: normalizeLinks(payload.links),
    specialRequirements: stringValue(payload.specialRequirements),
    primaryContact:
      normalizePerson(payload.primaryContact) ?? firstPerson(payload.contacts),
    accountsPayableContact: normalizePerson(payload.accountsPayableContact),
    billingAddress: stringValue(payload.billingAddress),
    shippingAddress: stringValue(payload.shippingAddress),
    billingSameAsShipping: booleanValue(payload.billingSameAsShipping),
    purchaseOrderNumber: stringValue(payload.purchaseOrderNumber),
    invoiceDeliveryMethod: stringValue(payload.invoiceDeliveryMethod),
    taxExempt: booleanValue(payload.taxExempt),
    taxExemptionType: stringValue(payload.taxExemptionType),
    taxExemptionFormReceived: booleanValue(payload.taxExemptionFormReceived),
    taxExemptionFormLocation: stringValue(payload.taxExemptionFormLocation),
    creditTermsRequested: booleanValue(payload.creditTermsRequested),
    requestedTerms: stringValue(payload.requestedTerms),
    estimatedFirstOrderValue:
      typeof payload.estimatedFirstOrderValue === "number"
        ? String(payload.estimatedFirstOrderValue)
        : stringValue(payload.estimatedFirstOrderValue),
    creditApprovalNotes: stringValue(payload.creditApprovalNotes),
    docusignRecipient: normalizePerson(payload.docusignRecipient),
    contractLink: stringValue(payload.contractLink),
    dunAndBradstreetId: stringValue(payload.dunAndBradstreetId),
    compliancePortal: stringValue(payload.compliancePortal),
    p21CustomerId: stringValue(payload.p21CustomerId),
    taxCode: stringValue(payload.taxCode),
    salesTerritory: stringValue(payload.salesTerritory),
    shippingMethod: stringValue(payload.shippingMethod),
    freightTerms: stringValue(payload.freightTerms),
    accountSetupBlockers: stringValue(payload.accountSetupBlockers),
    missingFields: [],
    raw: payload,
  };
  normalized.missingFields = missingFields(normalized);
  return normalized;
}

function missingFields(source: NormalizedCustomerOnboardingSource): string[] {
  const missing: string[] = [];
  if (!source.opportunityUrl) missing.push("opportunityUrl");
  if (!source.salesRep) missing.push("salesRep");
  if (source.contacts.length === 0) missing.push("contacts");
  if (!source.dealValue) missing.push("dealValue");
  if (!source.productPlan) missing.push("productPlan");
  if (!source.closeDate) missing.push("closeDate");
  if (source.documents.length === 0) missing.push("documents");
  if (!source.primaryContact) missing.push("primaryContact");
  if (!source.accountsPayableContact) missing.push("accountsPayableContact");
  if (!source.billingAddress) missing.push("billingAddress");
  if (!source.billingSameAsShipping && !source.shippingAddress) {
    missing.push("shippingAddress");
  }
  if (source.taxExempt === null) missing.push("taxExempt");
  if (source.creditTermsRequested === null) {
    missing.push("creditTermsRequested");
  }
  if (!source.docusignRecipient) missing.push("docusignRecipient");
  return missing;
}

function buildThreadTitle(source: NormalizedCustomerOnboardingSource): string {
  const customer =
    source.companyName ?? source.customerName ?? source.customerId;
  return `${customer} onboarding`;
}

function buildWorkflowMetadata(
  source: NormalizedCustomerOnboardingSource,
  startSource: CustomerOnboardingStartSource,
  space: CustomerOnboardingWorkflowSpace,
  humanInput: CustomerOnboardingHumanInputRequest | null,
): Record<string, unknown> {
  return {
    customerOnboarding: {
      source: startSource === "webhook" ? "lastmile_crm" : "manual",
      workflow: "customer_onboarding",
      opportunityId: source.opportunityId,
      customerId: source.customerId,
      customerName: source.customerName,
      companyName: source.companyName,
      missingFields: source.missingFields,
      spaceId: space.id,
      spacePrompt: space.prompt,
      facts: source,
      humanInput,
    },
  };
}

function buildKickoffMessage(
  source: NormalizedCustomerOnboardingSource,
): string {
  const lines = [
    `Customer onboarding started for ${source.companyName ?? source.customerName ?? source.customerId}.`,
    `Opportunity: ${source.opportunityId}${source.opportunityUrl ? ` (${source.opportunityUrl})` : ""}`,
  ];
  if (source.salesRep)
    lines.push(`Sales rep: ${formatPerson(source.salesRep)}`);
  if (source.dealValue) lines.push(`Deal value: ${source.dealValue}`);
  if (source.productPlan) lines.push(`Product/plan: ${source.productPlan}`);
  if (source.closeDate) lines.push(`Close date: ${source.closeDate}`);
  if (source.primaryContact) {
    lines.push(`Primary contact: ${formatPerson(source.primaryContact)}`);
  }
  if (source.accountsPayableContact) {
    lines.push(
      `Accounts payable contact: ${formatPerson(source.accountsPayableContact)}`,
    );
  }
  if (source.billingAddress)
    lines.push(`Billing address: ${source.billingAddress}`);
  if (source.shippingAddress) {
    lines.push(`Shipping address: ${source.shippingAddress}`);
  } else if (source.billingSameAsShipping) {
    lines.push("Shipping address: same as billing");
  }
  if (source.taxExempt !== null) {
    lines.push(`Tax exempt: ${source.taxExempt ? "yes" : "no"}`);
  }
  if (source.creditTermsRequested !== null) {
    lines.push(
      `Credit terms requested: ${source.creditTermsRequested ? "yes" : "no"}`,
    );
  }
  if (source.docusignRecipient) {
    lines.push(`DocuSign recipient: ${formatPerson(source.docusignRecipient)}`);
  }
  if (source.contractLink) lines.push(`Contract link: ${source.contractLink}`);
  if (source.dunAndBradstreetId) {
    lines.push(`Dun & Bradstreet ID: ${source.dunAndBradstreetId}`);
  }
  if (source.p21CustomerId)
    lines.push(`P21 customer ID: ${source.p21CustomerId}`);
  if (source.accountSetupBlockers) {
    lines.push(`Account setup blockers: ${source.accountSetupBlockers}`);
  }
  if (source.notes) lines.push(`Notes: ${source.notes}`);
  if (source.specialRequirements) {
    lines.push(`Special requirements: ${source.specialRequirements}`);
  }
  if (source.documents.length > 0) {
    lines.push(
      `Documents: ${source.documents.map((link) => link.title ?? link.url).join(", ")}`,
    );
  }
  if (source.missingFields.length > 0) {
    lines.push(`Missing onboarding fields: ${source.missingFields.join(", ")}`);
    lines.push(
      "Question: Please provide the missing onboarding information so the checklist can continue.",
    );
    for (const field of source.missingFields) {
      lines.push(`- ${questionFieldForMissingField(field).label}`);
    }
  }
  return lines.join("\n");
}

function renderTaskTitle(
  item: CustomerOnboardingChecklistItem,
  source: NormalizedCustomerOnboardingSource,
): string {
  const customer =
    source.companyName ?? source.customerName ?? source.customerId;
  const template = stringValue(
    objectRecord(item.externalTaskTemplate).titleTemplate,
  );
  if (template) {
    return template
      .replace(/\{\{\s*customer\s*\}\}/g, customer ?? "customer")
      .replace(/\{\{\s*opportunityId\s*\}\}/g, source.opportunityId);
  }
  return `${item.title} - ${customer}`;
}

function renderTaskDescription(
  item: CustomerOnboardingChecklistItem,
  source: NormalizedCustomerOnboardingSource,
): string {
  const base = item.description ? `${item.description}\n\n` : "";
  return `${base}${buildKickoffMessage(source)}`;
}

function shouldUseNativeChecklist(
  input: StartCustomerOnboardingWorkflowInput,
  space: CustomerOnboardingWorkflowSpace,
): boolean {
  return (
    input.source === "manual" ||
    stringValue(space.config?.checklistSystemOfRecord) === "thinkwork" ||
    stringValue(space.config?.systemOfRecord) === "thinkwork"
  );
}

function planNativeChecklistItems(
  space: CustomerOnboardingWorkflowSpace,
  threadId: string,
  source: NormalizedCustomerOnboardingSource,
): PlannedChecklistItem[] {
  return space.checklistItems.map((item) => {
    const applicability = evaluateChecklistApplicability(item, source);
    const assignee = resolveRoleAssignee(space, item.roleKey);
    const humanInput =
      item.key === "missing_onboarding_information" && applicability.applicable
        ? buildHumanInputRequest(source)
        : null;
    const task: CustomerOnboardingLinkedTaskResult = {
      checklistItemId: item.id,
      provider: "thinkwork",
      title: renderTaskTitle(item, source),
      externalTaskId: `thinkwork:${threadId}:${item.key}`,
      externalTaskUrl: null,
      status: applicability.applicable ? "todo" : "not_applicable",
      blocked: false,
      syncStatus: "synced",
    };
    return {
      item,
      task,
      required: applicability.required,
      assignee,
      metadata: {
        workflow: "customer_onboarding",
        systemOfRecord: "thinkwork",
        opportunityId: source.opportunityId,
        customerId: source.customerId,
        checklistItemKey: item.key,
        checklistTemplate: item.externalTaskTemplate,
        applicability,
        humanInput,
      },
    };
  });
}

function buildHumanInputRequest(
  source: NormalizedCustomerOnboardingSource,
): CustomerOnboardingHumanInputRequest | null {
  if (source.missingFields.length === 0) return null;
  return {
    skill: "human_question",
    channel: "thread",
    checklistItemKey: "missing_onboarding_information",
    prompt:
      "Please provide the missing onboarding information so the checklist can continue.",
    questionCard: {
      _type: "question_card",
      schema: {
        id: "customer_onboarding_missing_intake",
        title: "Missing onboarding information",
        fields: source.missingFields.map(questionFieldForMissingField),
      },
    },
  };
}

function questionFieldForMissingField(
  field: string,
): CustomerOnboardingQuestionField {
  const labels: Record<string, string> = {
    opportunityUrl: "Opportunity or quote link",
    salesRep: "Sales owner",
    contacts: "Primary customer contact",
    dealValue: "Estimated deal or first-order value",
    productPlan: "Product, plan, or customer class",
    closeDate: "Target onboarding or close date",
    documents: "Contract or order-form link",
    primaryContact: "Primary contact name and email",
    accountsPayableContact: "Accounts payable contact name and email",
    billingAddress: "Billing address",
    shippingAddress: "Shipping address",
    taxExempt: "Are they agricultural or sales-tax exempt?",
    creditTermsRequested: "Do they want credit terms?",
    docusignRecipient: "DocuSign recipient name and email",
  };
  return {
    id: field,
    label: labels[field] ?? field,
    type:
      field === "taxExempt" || field === "creditTermsRequested"
        ? "boolean"
        : "text",
  };
}

async function planExternalChecklistItems(input: {
  input: StartCustomerOnboardingWorkflowInput;
  space: CustomerOnboardingWorkflowSpace;
  threadId: string;
  normalized: NormalizedCustomerOnboardingSource;
  taskAdapter: LastMileTasksWorkflowAdapter;
}): Promise<PlannedChecklistItem[]> {
  const planned: PlannedChecklistItem[] = [];
  for (const item of input.space.checklistItems) {
    const assignee = resolveRoleAssignee(input.space, item.roleKey);
    const taskResult = await input.taskAdapter.createTask({
      tenantId: input.input.tenantId,
      spaceId: input.space.id,
      threadId: input.threadId,
      checklistItemId: item.id,
      idempotencyKey: `customer-onboarding:${input.input.tenantId}:${input.normalized.opportunityId}:${item.key}`,
      title: renderTaskTitle(item, input.normalized),
      description: renderTaskDescription(item, input.normalized),
      required: item.required,
      assignee,
      metadata: {
        workflow: "customer_onboarding",
        opportunityId: input.normalized.opportunityId,
        customerId: input.normalized.customerId,
        checklistItemKey: item.key,
        externalTaskTemplate: item.externalTaskTemplate,
      },
    });

    const task = taskResult.ok
      ? linkedTaskFromSnapshot(item, taskResult.value)
      : linkedTaskFromProviderError(
          input.threadId,
          item,
          taskResult.providerError,
        );
    planned.push({
      item,
      task,
      required: item.required,
      assignee: taskResult.ok ? taskResult.value.assignee : null,
      metadata: {
        workflow: "customer_onboarding",
        opportunityId: input.normalized.opportunityId,
        checklistItemKey: item.key,
        providerError: taskResult.ok ? undefined : taskResult.providerError,
        raw: taskResult.ok ? taskResult.value.raw : undefined,
      },
    });
  }
  return planned;
}

function evaluateChecklistApplicability(
  item: CustomerOnboardingChecklistItem,
  source: NormalizedCustomerOnboardingSource,
) {
  const template = objectRecord(item.externalTaskTemplate);
  const applicability = stringValue(template.applicability) ?? "always";
  const intakeField = stringValue(template.intakeField);
  if (applicability === "when_true") {
    const value = intakeField ? booleanIntakeValue(source, intakeField) : null;
    const applicable = value === true;
    if (value === null) {
      return {
        applicability,
        intakeField,
        applicable: true,
        required: false,
        pendingIntake: true,
        reason: `${intakeField ?? "intake field"} is not known yet`,
      };
    }
    return {
      applicability,
      intakeField,
      applicable,
      required: applicable && item.required,
      reason: applicable
        ? `${intakeField} is true`
        : `${intakeField ?? "intake field"} is not true`,
    };
  }
  if (applicability === "when_missing_required_intake") {
    const applicable = source.missingFields.length > 0;
    return {
      applicability,
      applicable,
      required: applicable && item.required,
      missingFields: source.missingFields,
      reason: applicable
        ? "required intake is missing"
        : "required intake is complete",
    };
  }
  return {
    applicability: "always",
    applicable: true,
    required: item.required,
    reason: "always required",
  };
}

function booleanIntakeValue(
  source: NormalizedCustomerOnboardingSource,
  field: string,
): boolean | null {
  if (field === "creditTermsRequested") return source.creditTermsRequested;
  if (field === "taxExempt") return source.taxExempt;
  return null;
}

function resolveRoleAssignee(
  space: CustomerOnboardingWorkflowSpace,
  roleKey: string | null,
) {
  if (!roleKey) return null;
  const roleAssignments = objectRecord(
    space.integration?.config?.roleAssignees ??
      space.integration?.config?.role_assignments ??
      space.config?.roleAssignees ??
      space.config?.role_assignments,
  );
  const assignment = objectRecord(roleAssignments[roleKey]);
  return {
    roleKey,
    externalId:
      stringValue(assignment.externalId) ?? stringValue(assignment.id),
    displayName:
      stringValue(assignment.displayName) ?? stringValue(assignment.name),
  };
}

function linkedTaskFromSnapshot(
  item: CustomerOnboardingChecklistItem,
  snapshot: LastMileTaskSnapshot,
): CustomerOnboardingLinkedTaskResult {
  return {
    checklistItemId: item.id,
    provider: "lastmile",
    title: snapshot.title ?? item.title,
    externalTaskId: snapshot.externalTaskId,
    externalTaskUrl: snapshot.externalTaskUrl,
    status: snapshot.status,
    blocked: snapshot.blocked,
    syncStatus: snapshot.syncStatus,
  };
}

function linkedTaskFromProviderError(
  threadId: string,
  item: CustomerOnboardingChecklistItem,
  providerError: LastMileProviderError,
): CustomerOnboardingLinkedTaskResult {
  return {
    checklistItemId: item.id,
    provider: "lastmile",
    title: item.title,
    externalTaskId: `pending:${threadId}:${item.id}`,
    externalTaskUrl: null,
    status: "unknown",
    blocked: false,
    syncStatus: "error",
    providerError,
  };
}

function createUnavailableLastMileTaskAdapter(): LastMileTasksWorkflowAdapter {
  return {
    async createTask() {
      return {
        ok: false,
        providerError: {
          code: "LASTMILE_TASKS_ADAPTER_NOT_CONFIGURED",
          message: "LastMile Tasks adapter is not configured",
          retryable: false,
        },
      };
    },
  };
}

class DrizzleCustomerOnboardingRepository
  implements CustomerOnboardingWorkflowRepository
{
  private readonly db = getDb();

  async findSpace(input: {
    tenantId: string;
    spaceId?: string | null;
  }): Promise<CustomerOnboardingWorkflowSpace | null> {
    const [space] = await this.db
      .select()
      .from(spaces)
      .where(
        input.spaceId
          ? and(
              eq(spaces.tenant_id, input.tenantId),
              eq(spaces.id, input.spaceId),
              eq(spaces.status, "active"),
            )
          : and(
              eq(spaces.tenant_id, input.tenantId),
              eq(spaces.template_key, CUSTOMER_ONBOARDING_TEMPLATE_KEY),
              eq(spaces.status, "active"),
            ),
      )
      .limit(1);
    if (!space) return null;

    const [template] = await this.db
      .select()
      .from(spaceChecklistTemplates)
      .where(
        and(
          eq(spaceChecklistTemplates.tenant_id, input.tenantId),
          eq(spaceChecklistTemplates.space_id, space.id),
        ),
      )
      .limit(1);
    const items = template
      ? await this.db
          .select()
          .from(spaceChecklistItems)
          .where(
            and(
              eq(spaceChecklistItems.tenant_id, input.tenantId),
              eq(spaceChecklistItems.template_id, template.id),
            ),
          )
          .orderBy(asc(spaceChecklistItems.sort_order))
      : [];
    const [integration] = await this.db
      .select()
      .from(spaceIntegrations)
      .where(
        and(
          eq(spaceIntegrations.tenant_id, input.tenantId),
          eq(spaceIntegrations.space_id, space.id),
          eq(spaceIntegrations.provider, "lastmile_tasks"),
          eq(spaceIntegrations.status, "active"),
        ),
      )
      .limit(1);

    return {
      id: space.id,
      tenantId: space.tenant_id,
      name: space.name,
      prompt: space.prompt,
      config: objectOrNull(space.config),
      checklistItems: items.map((item) => ({
        id: item.id,
        key: item.key,
        title: item.title,
        description: item.description,
        roleKey: item.role_key,
        required: item.required,
        externalTaskTemplate: objectOrNull(item.external_task_template),
      })),
      integration: integration
        ? {
            id: integration.id,
            writebackPolicy: integration.writeback_policy,
            config: objectOrNull(integration.config),
          }
        : null,
    };
  }

  async ensureNativeChecklist(input: {
    tenantId: string;
    spaceId: string;
  }): Promise<void> {
    await this.db.transaction(async (tx) => {
      const [template] = await tx
        .insert(spaceChecklistTemplates)
        .values({
          tenant_id: input.tenantId,
          space_id: input.spaceId,
          key: CUSTOMER_ONBOARDING_CHECKLIST_KEY,
          name: "Customer Onboarding v1",
          description:
            "Required native onboarding checklist items for ThinkWork-managed Customer Onboarding Threads.",
          config: buildCustomerOnboardingChecklistConfig(),
        })
        .onConflictDoUpdate({
          target: [
            spaceChecklistTemplates.tenant_id,
            spaceChecklistTemplates.space_id,
            spaceChecklistTemplates.key,
          ],
          set: {
            name: "Customer Onboarding v1",
            description:
              "Required native onboarding checklist items for ThinkWork-managed Customer Onboarding Threads.",
            config: buildCustomerOnboardingChecklistConfig(),
            updated_at: new Date(),
          },
        })
        .returning({ id: spaceChecklistTemplates.id });

      for (const item of CUSTOMER_ONBOARDING_CHECKLIST_ITEMS) {
        await tx
          .insert(spaceChecklistItems)
          .values({
            tenant_id: input.tenantId,
            space_id: input.spaceId,
            template_id: template.id,
            key: item.key,
            title: item.title,
            description: item.description,
            role_key: item.roleKey,
            required: item.required,
            sort_order: item.sortOrder,
            external_task_template: item.checklistTemplate,
          })
          .onConflictDoUpdate({
            target: [
              spaceChecklistItems.tenant_id,
              spaceChecklistItems.template_id,
              spaceChecklistItems.key,
            ],
            set: {
              title: item.title,
              description: item.description,
              role_key: item.roleKey,
              required: item.required,
              sort_order: item.sortOrder,
              external_task_template: item.checklistTemplate,
              updated_at: new Date(),
            },
          });
      }
    });
  }

  async findExistingThread(input: {
    tenantId: string;
    spaceId: string;
    opportunityId: string;
  }): Promise<CustomerOnboardingThreadRef | null> {
    const [thread] = await this.db
      .select()
      .from(threads)
      .where(
        and(
          eq(threads.tenant_id, input.tenantId),
          eq(threads.space_id, input.spaceId),
          sql`${threads.metadata}->'customerOnboarding'->>'opportunityId' = ${input.opportunityId}`,
        ),
      )
      .limit(1);
    return thread ? toThreadRef(thread) : null;
  }

  async createCase(
    input: CreateCustomerOnboardingCaseInput,
  ): Promise<CustomerOnboardingThreadRef> {
    const { thread } = await this.db.transaction(async (tx) => {
      const [tenant] = await tx
        .update(tenants)
        .set({ issue_counter: sql`${tenants.issue_counter} + 1` })
        .where(eq(tenants.id, input.tenantId))
        .returning({ next_number: sql<number>`${tenants.issue_counter}` });
      if (!tenant) {
        throw new CustomerOnboardingWorkflowError(
          "Tenant not found",
          404,
          "TENANT_NOT_FOUND",
        );
      }
      const prefix = input.channel === "webhook" ? "HOOK" : "TICK";
      const [thread] = await tx
        .insert(threads)
        .values({
          tenant_id: input.tenantId,
          space_id: input.space.id,
          number: tenant.next_number,
          identifier: `${prefix}-${tenant.next_number}`,
          title: input.title,
          status: "backlog",
          channel: input.channel,
          created_by_type: input.createdByType,
          created_by_id: input.createdById,
          user_id:
            input.createdByType === "user" ? input.createdById : undefined,
          metadata: input.metadata,
        })
        .returning();

      const participantRows: (typeof threadParticipants.$inferInsert)[] = [];
      if (input.createdByType === "user" && input.createdById) {
        participantRows.push({
          tenant_id: input.tenantId,
          thread_id: thread.id,
          space_id: input.space.id,
          participant_type: "user",
          user_id: input.createdById,
          role: "requester",
          source: "customer_onboarding_start",
        });
      }
      if (participantRows.length > 0) {
        await tx.insert(threadParticipants).values(participantRows);
      }

      await tx.insert(messages).values({
        thread_id: thread.id,
        tenant_id: input.tenantId,
        role: "system",
        content: input.kickoffMessage,
        sender_type: "system",
        tool_results: input.humanInput
          ? [input.humanInput.questionCard]
          : undefined,
        metadata: {
          kind: "customer_onboarding_kickoff",
          workflow: "customer_onboarding",
          humanInputRequest: input.humanInput ?? undefined,
        },
      });

      return { thread };
    });

    return toThreadRef(thread);
  }

  async createLinkedTask(
    input: CreateCustomerOnboardingLinkedTaskInput,
  ): Promise<void> {
    const [existing] = await this.db
      .select({ id: linkedTasks.id })
      .from(linkedTasks)
      .where(
        and(
          eq(linkedTasks.tenant_id, input.tenantId),
          eq(linkedTasks.thread_id, input.threadId),
          eq(linkedTasks.checklist_item_id, input.checklistItem.id),
        ),
      )
      .limit(1);
    if (existing) return;

    const [row] = await this.db
      .insert(linkedTasks)
      .values({
        tenant_id: input.tenantId,
        space_id: input.spaceId,
        thread_id: input.threadId,
        checklist_item_id: input.checklistItem.id,
        provider: input.task.provider,
        external_task_id: input.task.externalTaskId,
        external_task_url: input.task.externalTaskUrl,
        title: input.task.title,
        required: input.required,
        role_key: input.roleKey,
        assignee_display: input.assignee?.displayName ?? null,
        assignee_external_id: input.assignee?.externalId ?? null,
        status: input.task.status,
        blocked: input.task.blocked,
        sync_status: input.task.syncStatus,
        last_synced_at:
          input.task.syncStatus === "synced" ? new Date() : undefined,
        metadata: compactObject(input.metadata),
      })
      .returning({ id: linkedTasks.id });

    await this.db.insert(linkedTaskEvents).values({
      tenant_id: input.tenantId,
      linked_task_id: row.id,
      space_id: input.spaceId,
      thread_id: input.threadId,
      provider: input.task.provider,
      event_type: input.task.providerError ? "sync_failed" : "created",
      new_status: input.task.status,
      message: input.task.providerError
        ? input.task.providerError.message
        : "Linked task created",
      metadata: compactObject({
        providerError: input.task.providerError,
        checklistItemKey: input.checklistItem.key,
      }),
    });
  }
}

function toThreadRef(
  row: typeof threads.$inferSelect,
): CustomerOnboardingThreadRef {
  return {
    id: row.id,
    tenantId: row.tenant_id,
    spaceId: row.space_id,
    title: row.title,
    identifier: row.identifier,
    metadata: objectOrNull(row.metadata),
  };
}

function normalizePeople(value: unknown): CustomerOnboardingPerson[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => normalizePerson(item))
    .filter((person): person is CustomerOnboardingPerson => Boolean(person));
}

function firstPerson(value: unknown): CustomerOnboardingPerson | null {
  return normalizePeople(value)[0] ?? null;
}

function normalizePerson(value: unknown): CustomerOnboardingPerson | null {
  if (typeof value === "string") return { name: value };
  const record = objectRecord(value);
  const person = {
    id: stringValue(record.id),
    name: stringValue(record.name) ?? stringValue(record.displayName),
    email: stringValue(record.email),
  };
  return person.id || person.name || person.email ? person : null;
}

function booleanValue(value: unknown): boolean | null {
  if (typeof value === "boolean") return value;
  if (typeof value !== "string") return null;
  const normalized = value.trim().toLowerCase();
  if (["true", "yes", "y", "1"].includes(normalized)) return true;
  if (["false", "no", "n", "0"].includes(normalized)) return false;
  return null;
}

function normalizeLinks(value: unknown): CustomerOnboardingLink[] {
  if (!Array.isArray(value)) return [];
  return value
    .map((item) => {
      if (typeof item === "string") return { title: null, url: item };
      const record = objectRecord(item);
      const link = {
        title: stringValue(record.title) ?? stringValue(record.name),
        url: stringValue(record.url) ?? stringValue(record.href),
      };
      return link.title || link.url ? link : null;
    })
    .filter((link): link is CustomerOnboardingLink => Boolean(link));
}

function formatPerson(person: CustomerOnboardingPerson): string {
  if (person.name && person.email) return `${person.name} <${person.email}>`;
  return person.name ?? person.email ?? person.id ?? "Unknown";
}

function objectRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object"
    ? (value as Record<string, unknown>)
    : {};
}

function objectOrNull(value: unknown): Record<string, unknown> | null {
  const record = objectRecord(value);
  return Object.keys(record).length > 0 ? record : null;
}

function compactObject(
  value: Record<string, unknown>,
): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
