import { createThreadJsonRenderSpecHash } from "./hash.js";
import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderSpec,
} from "./spec.js";

export function createPrimitiveJsonRenderFixture(): ThreadJsonRenderPart {
  const spec = {
    root: "card",
    elements: {
      card: {
        type: "Card",
        props: {
          title: "Review queue",
          description: "Current generated UI direction",
          maxWidth: null,
          centered: false,
          className: null,
        },
        children: ["stack"],
      },
      stack: {
        type: "Stack",
        props: {
          direction: "vertical",
          gap: "sm",
          align: null,
          justify: null,
          className: null,
        },
        children: ["heading", "summary", "approve"],
      },
      heading: {
        type: "Heading",
        props: { text: "Pipeline health", level: "h3" },
        children: [],
      },
      summary: {
        type: "Text",
        props: { text: "All checks are ready.", variant: "body" },
        children: [],
      },
      approve: {
        type: "Button",
        props: { label: "Approve", variant: "primary", disabled: false },
        children: [],
      },
    },
  } satisfies ThreadJsonRenderSpec;

  return createThreadJsonRenderPart("json-render:primitive:review", spec, {
    title: "Pipeline health",
    summary: "All checks are ready.",
  });
}

export function createTaskReviewJsonRenderFixture(): ThreadJsonRenderPart {
  const spec = {
    root: "review",
    elements: {
      review: {
        type: "task.review",
        props: {
          title: "Review onboarding task",
          summary: "Confirm the customer kickoff task is ready.",
          status: "pending",
          primaryActionId: "approve-task",
        },
        children: [],
      },
    },
  } satisfies ThreadJsonRenderSpec;

  return createThreadJsonRenderPart(
    "json-render:task-review:123",
    spec,
    {
      title: "Review onboarding task",
      summary: "Confirm the customer kickoff task is ready.",
      lines: ["Status: pending"],
    },
    [
      {
        id: "approve-task",
        label: "Approve",
        kind: "approve",
        params: {
          target: "work_item_status",
          workItemId: "77777777-7777-7777-7777-777777777777",
          statusCategory: "DONE",
          note: "Approved from generated UI",
        },
      },
    ],
  );
}

export function createAnalyticsJsonRenderFixture(): ThreadJsonRenderPart {
  const spec = {
    root: "analytics",
    elements: {
      analytics: {
        type: "analytics.display",
        props: {
          kind: "analytics.display",
          analyticsDisplayVersion: "analytics-display/v1",
          title: "Support volume",
        },
        children: [],
      },
    },
  } satisfies ThreadJsonRenderSpec;

  return createThreadJsonRenderPart(
    "json-render:analytics:support-volume",
    spec,
    {
      title: "Support volume",
      summary: "Analytical display",
    },
  );
}

export function createResultListJsonRenderFixture(): ThreadJsonRenderPart {
  const spec = {
    root: "results",
    elements: {
      results: {
        type: "result.list",
        props: {
          title: "Agent handoff",
          summary: "Current work items, questions, reviews, and approvals.",
          groups: [
            { id: "work", title: "Work items" },
            { id: "questions", title: "User questions" },
            { id: "reviews", title: "Approval queue" },
          ],
          items: [
            {
              id: "work-item-1",
              variant: "workItem",
              groupId: "work",
              title: "Implement structured result list",
              summary: "Add a portable contract before renderer work starts.",
              statusLabel: "In progress",
              statusTone: "info",
              priorityLabel: "High",
              ownerLabel: "Codex",
              meta: [
                { label: "Linear", value: "THNK-82" },
                { label: "Branch", value: "codex/thnk-82-u1" },
              ],
              evidence: [
                {
                  label: "Plan",
                  text: "Renderer work waits on a validated catalog entry.",
                },
              ],
              primaryActionId: "complete-work-item",
            },
            {
              id: "question-1",
              variant: "question",
              groupId: "questions",
              title: "Which queue should ship first?",
              summary: "The agent needs a user choice before continuing.",
              statusLabel: "Awaiting answer",
              statusTone: "warning",
              required: true,
              secondaryActionId: "skip-question",
            },
            {
              id: "review-1",
              variant: "review",
              groupId: "reviews",
              title: "Review generated UI plan",
              statusLabel: "Needs review",
              statusTone: "neutral",
              reviewerLabel: "Operator",
              recommendationLabel: "Approve",
            },
            {
              id: "summary-1",
              variant: "genericSummary",
              title: "Workspace defaults are aligned",
              statusLabel: "Ready",
              statusTone: "success",
              sourceLabel: "Runtime guidance",
            },
          ],
          emptyState: {
            title: "No results",
            summary: "There are no generated results to show.",
          },
        },
        children: [],
      },
    },
  } satisfies ThreadJsonRenderSpec;

  return createThreadJsonRenderPart(
    "json-render:result-list:handoff",
    spec,
    {
      title: "Agent handoff",
      summary: "Current work items, questions, reviews, and approvals.",
      lines: [
        "Work item: Implement structured result list",
        "Question: Which queue should ship first?",
        "Review: Review generated UI plan",
      ],
    },
    [
      {
        id: "complete-work-item",
        label: "Complete",
        kind: "submit",
        params: {
          target: "work_item_status",
          workItemId: "77777777-7777-7777-7777-777777777777",
          statusCategory: "DONE",
        },
      },
      {
        id: "skip-question",
        label: "Skip",
        kind: "reject",
        params: {
          target: "user_question",
          questionId: "88888888-8888-8888-8888-888888888888",
          response: "skip",
        },
      },
    ],
  );
}

export function createThreadJsonRenderPart(
  id: string,
  spec: ThreadJsonRenderSpec,
  mobileFallback: ThreadJsonRenderPart["data"]["mobileFallback"],
  durableActions?: ThreadJsonRenderPart["data"]["durableActions"],
): ThreadJsonRenderPart {
  return {
    type: THREAD_JSON_RENDER_PART_TYPE,
    id,
    data: {
      schemaVersion: THREAD_JSON_RENDER_SCHEMA_VERSION,
      catalogVersion: THREAD_JSON_RENDER_CATALOG_VERSION,
      status: "ready",
      spec,
      mobileFallback,
      durableActions,
      specHash: createThreadJsonRenderSpecHash(spec),
    },
  };
}
