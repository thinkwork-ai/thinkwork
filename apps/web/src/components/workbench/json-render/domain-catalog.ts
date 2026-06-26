import { z } from "zod"

export const threadJsonRenderDomainComponentDefinitions = {
  "task.review": {
    props: z.object({
      title: z.string(),
      summary: z.string(),
      status: z.enum(["pending", "approved", "rejected", "needs_review"]),
      priority: z.string().nullable().optional(),
      assigneeLabel: z.string().nullable().optional(),
      primaryActionId: z.string().nullable().optional(),
    }),
    slots: ["default"],
    description: "ThinkWork task review and approval surface.",
    example: {
      title: "Review onboarding task",
      summary: "Confirm the customer kickoff task is ready.",
      status: "pending",
    },
  },
  "workflow.status": {
    props: z.object({
      title: z.string(),
      status: z.enum(["queued", "running", "blocked", "completed", "failed"]),
      steps: z
        .array(
          z.object({
            id: z.string(),
            title: z.string(),
            status: z.enum([
              "queued",
              "running",
              "blocked",
              "completed",
              "failed",
            ]),
            summary: z.string().optional(),
          }),
        )
        .optional(),
    }),
    slots: ["default"],
    description: "ThinkWork workflow status summary.",
    example: {
      title: "Onboarding workflow",
      status: "running",
    },
  },
  "keyValue.list": {
    props: z.object({
      title: z.string().optional(),
      items: z.array(
        z.object({
          label: z.string(),
          value: z.union([z.string(), z.number(), z.boolean(), z.null()]),
        }),
      ),
    }),
    slots: ["default"],
    description: "Compact key/value list for generated Thread summaries.",
    example: {
      title: "Customer facts",
      items: [{ label: "Status", value: "Ready" }],
    },
  },
  "form.action": {
    props: z.object({
      title: z.string(),
      description: z.string().optional(),
      fields: z
        .array(
          z.object({
            id: z.string(),
            label: z.string(),
            type: z.enum(["text", "textarea", "select", "checkbox"]),
            required: z.boolean().optional(),
            options: z.array(z.string()).optional(),
          }),
        )
        .optional(),
      submitActionId: z.string().nullable().optional(),
    }),
    slots: ["default"],
    description: "Bounded form composition for a durable ThinkWork action.",
    example: {
      title: "Request approval",
      submitActionId: "submit-approval",
    },
  },
  "analytics.display": {
    props: z
      .object({
        kind: z.literal("analytics.display"),
        analyticsDisplayVersion: z.string(),
      })
      .passthrough(),
    slots: ["default"],
    description:
      "ThinkWork analytics-display adapter backed by @thinkwork/analytics-display.",
    example: {
      kind: "analytics.display",
      analyticsDisplayVersion: "analytics-display/v1",
    },
  },
} as const

export type ThreadJsonRenderDomainComponent =
  keyof typeof threadJsonRenderDomainComponentDefinitions

export const threadJsonRenderDomainComponentNames = Object.keys(
  threadJsonRenderDomainComponentDefinitions,
) as ThreadJsonRenderDomainComponent[]
