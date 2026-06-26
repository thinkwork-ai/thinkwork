import {
  THREAD_JSON_RENDER_CATALOG_VERSION,
  THREAD_JSON_RENDER_PART_TYPE,
  THREAD_JSON_RENDER_SCHEMA_VERSION,
  createThreadJsonRenderSpecHash,
  type ThreadJsonRenderPart,
  type ThreadJsonRenderSpec,
} from "./validation"

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
  } satisfies ThreadJsonRenderSpec

  return createThreadJsonRenderPart("json-render:primitive:review", spec, {
    title: "Pipeline health",
    summary: "All checks are ready.",
  })
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
  } satisfies ThreadJsonRenderSpec

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
        params: { taskId: "task-123" },
      },
    ],
  )
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
  } satisfies ThreadJsonRenderSpec

  return createThreadJsonRenderPart(
    "json-render:analytics:support-volume",
    spec,
    {
      title: "Support volume",
      summary: "Analytical display",
    },
  )
}

function createThreadJsonRenderPart(
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
  }
}
