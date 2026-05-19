export const CUSTOMER_ONBOARDING_SPACE_SLUG = "customer-onboarding";
export const CUSTOMER_ONBOARDING_CHECKLIST_KEY = "customer-onboarding-v1";

export interface CustomerOnboardingRoleAssigneeSeed {
  externalId?: string | null;
  displayName?: string | null;
}

export type CustomerOnboardingRoleAssigneesSeed = Record<
  string,
  CustomerOnboardingRoleAssigneeSeed
>;

export interface CustomerOnboardingChecklistItemSeed {
  key: string;
  title: string;
  description: string;
  roleKey: "sales" | "accounting" | "finance" | "operations";
  required: boolean;
  sortOrder: number;
  externalTaskTemplate: {
    provider: "lastmile_tasks";
    taskType: string;
    titleTemplate: string;
  };
}

export const CUSTOMER_ONBOARDING_SPACE_PROMPT = [
  "Coordinate customer onboarding after a closed-won opportunity.",
  "Keep the Thread factual, ask humans for missing source information, and keep required checklist tasks moving.",
  "LastMile Tasks is the task system of record; use ThinkWork for coordination, context, and status summaries.",
].join(" ");

export const CUSTOMER_ONBOARDING_COORDINATOR_INSTRUCTIONS = [
  "Act as the onboarding coordinator for this Space.",
  "On kickoff, summarize missing CRM fields, unassigned checklist tasks, and likely blockers.",
  "Do not mark work complete unless the linked external task mirror shows completion or a human confirms it in the Thread.",
].join(" ");

export const CUSTOMER_ONBOARDING_CHECKLIST_ITEMS: CustomerOnboardingChecklistItemSeed[] =
  [
    {
      key: "docusign",
      title: "Send DocuSign package",
      description:
        "Prepare and send the customer onboarding DocuSign package using the closed-won opportunity details.",
      roleKey: "sales",
      required: true,
      sortOrder: 10,
      externalTaskTemplate: {
        provider: "lastmile_tasks",
        taskType: "docusign",
        titleTemplate: "Send DocuSign package - {{customer}}",
      },
    },
    {
      key: "sales_tax_exemption",
      title: "Collect sales tax exemption form",
      description:
        "Collect, review, and attach the customer's sales tax exemption documentation when applicable.",
      roleKey: "accounting",
      required: true,
      sortOrder: 20,
      externalTaskTemplate: {
        provider: "lastmile_tasks",
        taskType: "tax_exemption",
        titleTemplate: "Collect sales tax exemption form - {{customer}}",
      },
    },
    {
      key: "erp_customer_setup",
      title: "Enter company into ERP",
      description:
        "Create or update the company record in ERP with billing, shipping, and contact details from the opportunity.",
      roleKey: "operations",
      required: true,
      sortOrder: 30,
      externalTaskTemplate: {
        provider: "lastmile_tasks",
        taskType: "erp_setup",
        titleTemplate: "Enter company into ERP - {{customer}}",
      },
    },
    {
      key: "credit_report",
      title: "Run credit report",
      description:
        "Run the required credit check and record the approval, hold, or follow-up status.",
      roleKey: "finance",
      required: true,
      sortOrder: 40,
      externalTaskTemplate: {
        provider: "lastmile_tasks",
        taskType: "credit_report",
        titleTemplate: "Run credit report - {{customer}}",
      },
    },
    {
      key: "internal_kickoff",
      title: "Confirm onboarding owner and kickoff notes",
      description:
        "Confirm the internal owner, note any special requirements, and make sure the Thread has the required source context.",
      roleKey: "sales",
      required: false,
      sortOrder: 50,
      externalTaskTemplate: {
        provider: "lastmile_tasks",
        taskType: "kickoff_review",
        titleTemplate:
          "Confirm onboarding owner and kickoff notes - {{customer}}",
      },
    },
  ];

export function buildCustomerOnboardingSpaceConfig(
  input: {
    roleAssignees?: CustomerOnboardingRoleAssigneesSeed;
  } = {},
) {
  return compactObject({
    workflow: "customer_onboarding",
    version: 1,
    roleAssignees: cleanRoleAssignees(input.roleAssignees),
  });
}

export function buildCustomerOnboardingChecklistConfig() {
  return {
    workflow: "customer_onboarding",
    version: 1,
    source: "thinkwork_seed",
  };
}

export function buildLastMileIntegrationConfig(
  input: {
    roleAssignees?: CustomerOnboardingRoleAssigneesSeed;
    externalProjectId?: string | null;
  } = {},
) {
  return compactObject({
    workflow: "customer_onboarding",
    version: 1,
    externalProjectId: input.externalProjectId || undefined,
    roleAssignees: cleanRoleAssignees(input.roleAssignees),
  });
}

export function parseRoleAssigneesJson(
  value: string | null | undefined,
): CustomerOnboardingRoleAssigneesSeed {
  if (!value?.trim()) return {};
  const parsed = JSON.parse(value) as unknown;
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("ROLE_ASSIGNEES_JSON must be a JSON object");
  }
  const assignees: CustomerOnboardingRoleAssigneesSeed = {};
  for (const [roleKey, raw] of Object.entries(
    parsed as Record<string, unknown>,
  )) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) {
      throw new Error(`role assignee ${roleKey} must be an object`);
    }
    const record = raw as Record<string, unknown>;
    assignees[roleKey] = {
      externalId: stringOrNull(record.externalId) ?? stringOrNull(record.id),
      displayName:
        stringOrNull(record.displayName) ?? stringOrNull(record.name),
    };
  }
  return assignees;
}

function cleanRoleAssignees(
  assignees: CustomerOnboardingRoleAssigneesSeed | undefined,
) {
  if (!assignees || Object.keys(assignees).length === 0) return undefined;
  return Object.fromEntries(
    Object.entries(assignees).map(([roleKey, assignee]) => [
      roleKey,
      compactObject({
        externalId: assignee.externalId || undefined,
        displayName: assignee.displayName || undefined,
      }),
    ]),
  );
}

function compactObject<T extends Record<string, unknown>>(value: T) {
  return Object.fromEntries(
    Object.entries(value).filter(([, child]) => child !== undefined),
  );
}

function stringOrNull(value: unknown) {
  return typeof value === "string" && value.trim() ? value.trim() : null;
}
