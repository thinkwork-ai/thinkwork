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
  checklistTemplate: {
    provider: "thinkwork";
    taskType: string;
    titleTemplate: string;
    applicability: "always" | "when_true" | "when_missing_required_intake";
    intakeField?: "creditTermsRequested" | "taxExempt";
  };
}

export interface CustomerOnboardingSpaceSourceFileSeed {
  path: string;
  content: string;
}

export const CUSTOMER_ONBOARDING_SPACE_PROMPT = [
  "Coordinate customer onboarding from a ThinkWork-native checklist.",
  "Keep the Thread factual, ask humans for missing source information, and keep required onboarding steps moving.",
  "Use ThinkWork as the system of record for the initial checklist; external systems are manual steps until integrations are enabled.",
].join(" ");

export const CUSTOMER_ONBOARDING_COORDINATOR_INSTRUCTIONS = [
  "Act as the onboarding coordinator for this Space.",
  "On kickoff, summarize missing intake answers, required checklist items, and likely blockers.",
  "Do not mark work complete automatically; recommend completion only after required ThinkWork checklist items are complete and a human confirms it in the Thread.",
].join(" ");

export const CUSTOMER_ONBOARDING_CHECKLIST_ITEMS: CustomerOnboardingChecklistItemSeed[] =
  [
    {
      key: "docusign_package",
      title: "Send and receive DocuSign package",
      description:
        "Prepare, send, and confirm completion of the customer onboarding DocuSign package.",
      roleKey: "sales",
      required: true,
      sortOrder: 10,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "docusign",
        titleTemplate: "Send and receive DocuSign package - {{customer}}",
        applicability: "always",
      },
    },
    {
      key: "dun_and_bradstreet_check",
      title: "Check Dun & Bradstreet information",
      description:
        "Review the customer's Dun & Bradstreet information and record any risk, mismatch, or manual follow-up needed.",
      roleKey: "finance",
      required: true,
      sortOrder: 20,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "dun_and_bradstreet",
        titleTemplate: "Check Dun & Bradstreet information - {{customer}}",
        applicability: "always",
      },
    },
    {
      key: "credit_check",
      title: "Run credit check",
      description:
        "Run the credit review when the customer requests credit terms and record approval, hold, or follow-up status.",
      roleKey: "finance",
      required: true,
      sortOrder: 30,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "credit_check",
        titleTemplate: "Run credit check - {{customer}}",
        applicability: "when_true",
        intakeField: "creditTermsRequested",
      },
    },
    {
      key: "tax_exemption_forms",
      title: "Collect tax exemption forms",
      description:
        "Collect, validate, and attach the customer's agricultural or sales-tax exemption documentation when applicable.",
      roleKey: "accounting",
      required: true,
      sortOrder: 40,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "tax_exemption",
        titleTemplate: "Collect tax exemption forms - {{customer}}",
        applicability: "when_true",
        intakeField: "taxExempt",
      },
    },
    {
      key: "p21_customer_setup",
      title: "Enter customer information into P21",
      description:
        "Create or update the customer record in P21 with billing, shipping, tax, contact, territory, and freight details.",
      roleKey: "operations",
      required: true,
      sortOrder: 50,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "p21_customer_setup",
        titleTemplate: "Enter customer information into P21 - {{customer}}",
        applicability: "always",
      },
    },
    {
      key: "missing_onboarding_information",
      title: "Resolve missing onboarding information",
      description:
        "Fill in required intake answers that were unknown at kickoff before final onboarding review.",
      roleKey: "sales",
      required: true,
      sortOrder: 60,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "missing_information",
        titleTemplate: "Resolve missing onboarding information - {{customer}}",
        applicability: "when_missing_required_intake",
      },
    },
    {
      key: "final_onboarding_review",
      title: "Complete final onboarding review",
      description:
        "Confirm required onboarding work is complete, summarize outcomes in the Thread, and mark the Thread done after human review.",
      roleKey: "operations",
      required: true,
      sortOrder: 70,
      checklistTemplate: {
        provider: "thinkwork",
        taskType: "final_review",
        titleTemplate: "Complete final onboarding review - {{customer}}",
        applicability: "always",
      },
    },
  ];

export const CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES: CustomerOnboardingSpaceSourceFileSeed[] =
  [
    {
      path: "CONTEXT.md",
      content: `# Customer Onboarding - Context

## What This Is

This Space coordinates customer onboarding from a ThinkWork-native checklist. A user starts an onboarding Thread, answers the intake questions, and ThinkWork creates the required checklist items for the case.

## Operating Contract

- Keep the Thread as the case file for kickoff facts, missing answers, checklist status, blocker discussion, documents, and final summary.
- Read \`docs/customer-onboarding-intake.md\` before creating or interpreting onboarding checklist work.
- Treat DocuSign, Dun & Bradstreet, credit review, tax exemption forms, and P21 setup as manual checklist steps until external integrations are enabled.
- When required intake is missing, ask the human in the Thread using the Human Question skill pattern from \`docs/customer-onboarding-intake.md\`; keep the missing-information checklist row open until the answer is captured.
- Do not mark onboarding complete automatically. Required checklist items must be complete and a human must confirm completion.

## Folder Structure

\`\`\`
customer-onboarding/
|-- CONTEXT.md <- You are here
\`-- docs/
    \`-- customer-onboarding-intake.md <- Intake questions and checklist rules
\`\`\`

## Token Management

Load only this file and \`docs/customer-onboarding-intake.md\` for ordinary onboarding coordination. Do not load unrelated Space files unless the Thread asks for them.

## Skills & Human Input

Use the Human Question skill pattern when you need a human answer before the checklist can move forward:

- Ask in the current Thread; do not create an external task or side-channel.
- Ask grouped, answerable questions using the question-card schema in \`docs/customer-onboarding-intake.md\`.
- Tie the request to the \`missing_onboarding_information\` checklist row.
- After the human answers, summarize the captured facts in the Thread and update checklist rows that are now unblocked.
`,
    },
    {
      path: "docs/customer-onboarding-intake.md",
      content: `# Customer Onboarding Intake

## Customer and Opportunity

- Customer legal name
- Customer display/common name
- Opportunity or quote identifier
- Sales owner
- Primary contact name, email, and phone
- Accounts payable contact name and email
- Target onboarding/completion date
- Notes or special requirements

## Billing and Shipping

- Billing address
- Shipping address
- Are billing and shipping the same?
- Required purchase order number, if any
- Preferred invoice delivery method

## Tax

- Are they agricultural/sales-tax exempt?
- If yes, which exemption type or jurisdiction?
- Has the exemption form already been received?
- If received, where is the form located?

## Credit Terms

- Do they want credit terms?
- Requested terms, if known
- Estimated first order value or credit exposure
- Existing credit approval or prior relationship notes

## Contract and Compliance

- DocuSign recipient name and email
- Contract/order form link, if already prepared
- Dun & Bradstreet identifier, if known
- Any required compliance or vendor onboarding portals

## ERP / P21 Setup

- P21 customer ID, if this is an existing customer
- Tax code or customer class, if known
- Sales territory or branch
- Required shipping method or freight terms
- Any account setup blockers

## Checklist Rules

- Always required: send/get DocuSign package, check Dun & Bradstreet information, enter customer information into P21, final onboarding review.
- Required when \`creditTermsRequested = true\`: run credit check.
- Required when \`taxExempt = true\`: collect and validate tax exemption forms.
- Required when required intake is missing: resolve missing onboarding information.
- Optional/manual override: any item can be marked not applicable by a human with a note.

## Human Question Skill Pattern

Use this pattern when the agent needs to elicit missing onboarding information from a human.

1. State the blocking checklist item.
2. Ask only for the missing fields needed to move the workflow forward.
3. Prefer a Question Card when the runtime supports \`present_form\`; otherwise ask the same fields as a concise Thread reply.
4. Keep answers in the Thread and treat the Thread as the case file.

Question Card result shape:

\`\`\`json
{
  "_type": "question_card",
  "schema": {
    "id": "customer_onboarding_missing_intake",
    "title": "Missing onboarding information",
    "fields": [
      {
        "id": "taxExempt",
        "label": "Are they agricultural or sales-tax exempt?",
        "type": "boolean"
      },
      {
        "id": "creditTermsRequested",
        "label": "Do they want credit terms?",
        "type": "boolean"
      },
      {
        "id": "docusignRecipient",
        "label": "Who should receive the DocuSign package?",
        "type": "text"
      }
    ]
  }
}
\`\`\`
`,
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
    checklistSystemOfRecord: "thinkwork",
    sourceFiles: CUSTOMER_ONBOARDING_SPACE_SOURCE_FILES.map(
      (file) => file.path,
    ),
    roleAssignees: cleanRoleAssignees(input.roleAssignees),
  });
}

export function buildCustomerOnboardingChecklistConfig() {
  return {
    workflow: "customer_onboarding",
    version: 1,
    source: "thinkwork_seed",
    systemOfRecord: "thinkwork",
    applicabilityFields: ["creditTermsRequested", "taxExempt"],
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
    phase: "external_task_integration",
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
