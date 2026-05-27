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
- Treat \`goals/customer-onboarding/GOAL.md\` as the portable Goal template for this workflow. It defines the outcome, Delegate/Collaborate mode, review policy, completion rule, and folder files that should be created for each promoted onboarding Thread.
- Read \`docs/customer-onboarding-intake.md\` before creating or interpreting onboarding checklist work.
- Treat the Info Panel Goal panel as the canonical onboarding status surface. Checklist progress is the v1 progress model inside the broader Goal. If a user asks "status", "progress", or "what is the status?", answer from the Goal outcome, checklist rows, owners, blockers, and review readiness.
- Treat DocuSign, Dun & Bradstreet, credit review, tax exemption forms, and P21 setup as manual checklist steps until external integrations are enabled.
- When required intake is missing, ask the human in the Thread using the Human Question skill pattern from \`docs/customer-onboarding-intake.md\`; keep the missing-information checklist row open until the answer is captured.
- When a human gives a task update in chat, map it back to the matching Progress item. "Done" means completed; "sent", "started", or "submitted" means in progress unless the reply says it is waiting on someone; "waiting on", "blocked", or "on hold" means blocked; "not applicable" means not applicable.
- For credit review, phrases like "credit approved", "credit check complete", or "limit set at $10k" complete the credit-check Progress item and should be recorded as credit approval notes. Do not answer with generic CRM/tool guidance.
- Every Progress item needs an owner signal. Prefer an assigned Space member; otherwise use the role owner: Sales, Finance, Accounting, or Operations.
- Do not mark onboarding complete automatically. Required checklist items must be complete and a human must confirm completion.

## Folder Structure

\`\`\`
customer-onboarding/
|-- CONTEXT.md <- You are here
|-- docs/
|   \`-- customer-onboarding-intake.md <- Intake questions and checklist rules
\`-- goals/
    \`-- customer-onboarding/
        |-- GOAL.md <- Portable Goal contract
        |-- PROGRESS.md <- Rendered operational briefing shape
        |-- DECISIONS.md <- Decision log template
        |-- ARTIFACTS.md <- Artifact index template
        |-- HANDOFFS.md <- Handoff notes template
        \`-- stages/
            |-- kickoff/CONTEXT.md
            \`-- final-review/OUTPUT.md
\`\`\`

## Token Management

Load this file, \`docs/customer-onboarding-intake.md\`, and the relevant Goal template files under \`goals/customer-onboarding/\` for ordinary onboarding coordination. Do not load unrelated Space files unless the Thread asks for them.

## Skills & Human Input

Use the Human Question skill pattern when you need a human answer before the checklist can move forward:

- Ask in the current Thread; do not create an external task or side-channel.
- Ask grouped, answerable questions using the question-card schema in \`docs/customer-onboarding-intake.md\`.
- Tie the request to the \`missing_onboarding_information\` checklist row.
- After the human answers, summarize the captured facts in the Thread and update checklist rows that are now unblocked.

## Status Responses

When a user asks for status, respond with:

- Goal outcome and current mode, if a Goal has been created.
- Overall Progress, for example: \`3/6 required onboarding tasks complete\`.
- Blockers and who owns them.
- Required tasks still waiting, grouped by owner/role.
- Missing intake answers, if any.
- Whether the Thread can be completed.
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

Checklist progress is the v1 progress model for the Customer Onboarding Goal. The Goal itself also tracks outcome, mode, review policy, decision notes, artifact references, and handoffs.

- Always required: send/get DocuSign package, check Dun & Bradstreet information, enter customer information into P21, final onboarding review.
- Required when \`creditTermsRequested = true\`: run credit check.
- Required when \`taxExempt = true\`: collect and validate tax exemption forms.
- Required when required intake is missing: resolve missing onboarding information.
- Optional/manual override: any item can be marked not applicable by a human with a note.

## Progress Status Rules

The Spaces Info Panel shows the canonical Progress list.

- Todo: task exists but no work has started.
- In progress: work has started or has been sent/submitted.
- Blocked: work is waiting on another person, missing approval, missing forms, or another blocker.
- Completed: the owner verified the task is done.
- Not applicable: a human confirmed the task does not apply to this customer.

Use Progress, not generic CRM or lead status, when someone asks "what is the status?" inside this Space.
For credit review, a human reply such as "credit check approved for $10k" or "credit limit set at $10k" means the credit-check task is completed and the approval/limit should be kept in the Thread state.

## Owners

- DocuSign package and missing intake: Sales.
- Dun & Bradstreet and credit check: Finance.
- Tax exemption forms: Accounting.
- P21 setup and final review: Operations.
- If a Space member is assigned to the role, show that member as the owner; otherwise show the role as the owner.

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
    {
      path: "goals/customer-onboarding/GOAL.md",
      content: `# Customer Onboarding Goal Template

## Minimum Goal Contract

- Outcome: onboard the customer after a closed-won opportunity so they can be billed, shipped to, and serviced without missing finance, accounting, sales, or operations steps.
- Mode: Collaborate by default. The agent coordinates, asks for missing facts, keeps the checklist moving, and drafts next steps; humans remain accountable for external-system work and final review.
- Owner: the requesting user or assigned onboarding owner in the Thread.
- Progress model: ThinkWork linked checklist rows rendered into \`PROGRESS.md\`.
- Completion rule: all required, applicable checklist rows are completed or marked not applicable with notes.
- Review policy: human confirmation is required before the Goal is completed. The agent may recommend final review, but must not silently close the Goal.

## Expected Instance Folder

When a Thread is promoted into a Customer Onboarding Goal, create or refresh these files under the Thread folder:

- \`GOAL.md\`: instance-specific outcome, mode, owner, completion rule, and review policy.
- \`PROGRESS.md\`: current checklist progress rendered from Aurora state.
- \`DECISIONS.md\`: decisions that changed onboarding handling.
- \`ARTIFACTS.md\`: links or references to contracts, tax forms, screenshots, exports, and generated deliverables.
- \`HANDOFFS.md\`: handoff notes between Sales, Finance, Accounting, Operations, and the customer-facing team.

## Local / Portable Fallback

If ThinkWork tools, GraphQL, or the Info Panel are unavailable, use the markdown folder as the working context:

1. Read this file, \`PROGRESS.md\`, and \`docs/customer-onboarding-intake.md\`.
2. Treat checklist rows in \`PROGRESS.md\` as a snapshot, not the authority of record.
3. Ask humans for missing source information in the Thread or local session.
4. Record durable decisions in \`DECISIONS.md\`, artifacts in \`ARTIFACTS.md\`, and handoffs in \`HANDOFFS.md\`.
5. Flag any structured-state changes that must be reconciled back into ThinkWork when tools return.
`,
    },
    {
      path: "goals/customer-onboarding/PROGRESS.md",
      content: `# Customer Onboarding Progress Template

This file is a rendered operational briefing for a Customer Onboarding Goal. Structured task status stays canonical in ThinkWork/Aurora; this markdown helps agents and humans understand the current state.

## Goal Snapshot

- Outcome:
- Mode: Collaborate
- Owner:
- Review policy: human final review required
- Completion rule: all required applicable checklist rows complete or not applicable with notes

## Required Progress

List each required checklist row with status, owner, blocker notes, and source timestamp.

## Missing Intake

List unanswered fields from \`docs/customer-onboarding-intake.md\` that block progress.

## Readiness

State whether the Goal is ready for human final review and why.
`,
    },
    {
      path: "goals/customer-onboarding/DECISIONS.md",
      content: `# Customer Onboarding Decisions Template

Use this file for decisions that explain why onboarding proceeded a certain way. These notes are high-signal Company Brain inputs after completion.

## Decision Log

| Date | Decision | Made by | Evidence / Source | Follow-up |
| ---- | -------- | ------- | ----------------- | --------- |

## Examples

- Credit terms approved, held, or changed.
- Tax exemption accepted, rejected, or deferred.
- P21 setup exception or special billing/shipping handling.
- Human reviewer approved a not-applicable checklist item.

## Local / Portable Fallback

If ThinkWork tools are unavailable, write the decision here with enough evidence for a later operator to reconcile the structured Goal state.
`,
    },
    {
      path: "goals/customer-onboarding/ARTIFACTS.md",
      content: `# Customer Onboarding Artifacts Template

Use this file to index artifacts produced or collected during the Goal.

## Artifact Index

| Artifact | Type | Location | Status | Notes |
| -------- | ---- | -------- | ------ | ----- |

## Expected Artifacts

- Contract or order form.
- Completed DocuSign package.
- Tax exemption forms, if applicable.
- Credit approval or credit hold evidence.
- P21/customer setup confirmation.

## Local / Portable Fallback

If ThinkWork artifact tools are unavailable, record stable links, filenames, or handoff notes here so the artifact can be reattached later.
`,
    },
    {
      path: "goals/customer-onboarding/HANDOFFS.md",
      content: `# Customer Onboarding Handoffs Template

Use this file when work moves between Sales, Finance, Accounting, Operations, or a customer-facing owner.

## Current Handoff

- From:
- To:
- Needed by:
- Context:
- Done when:

## Handoff History

| Date | From | To | Reason | Status |
| ---- | ---- | -- | ------ | ------ |

## Local / Portable Fallback

If ThinkWork tools are unavailable, write handoff expectations here and call out which checklist rows need reconciliation later.
`,
    },
    {
      path: "goals/customer-onboarding/stages/kickoff/CONTEXT.md",
      content: `# Kickoff Stage Context

Purpose: convert closed-won opportunity facts into a Customer Onboarding Goal instance.

## Inputs

- Customer legal/display name.
- Primary and accounts-payable contacts.
- Contract or order-form link.
- Billing and shipping details.
- Tax exemption and credit terms answers.

## Agent Behavior

- Ask grouped, answerable questions for missing required intake.
- Create or refresh checklist rows from the Goal progress model.
- Keep the Thread factual and avoid marking completion.

## Output

Updated \`GOAL.md\`, \`PROGRESS.md\`, and any missing-intake questions needed to move the Goal forward.
`,
    },
    {
      path: "goals/customer-onboarding/stages/final-review/OUTPUT.md",
      content: `# Final Review Stage Output

Use this file shape when the Goal is ready for human final review.

## Completion Evidence

- Required checklist rows complete:
- Not-applicable rows with notes:
- Remaining blockers:
- Artifact references:
- Decisions that should compound into Company Brain:

## Review Request

Ask the human reviewer to confirm completion or request changes. The agent may summarize readiness, but the human reviewer decides whether the Goal can close.
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
