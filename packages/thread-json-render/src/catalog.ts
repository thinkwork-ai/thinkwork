import { defineCatalog, defineSchema } from "@json-render/core";
import { shadcnComponentDefinitions } from "@json-render/shadcn/catalog";
import { z } from "zod";

const resultListMetaValueSchema = z.union([
  z.string(),
  z.number(),
  z.boolean(),
  z.null(),
]);

const resultListMetaItemSchema = z
  .object({
    label: z.string(),
    value: resultListMetaValueSchema,
  })
  .strict();

const resultListEvidenceSchema = z
  .object({
    label: z.string().nullable().optional(),
    text: z.string(),
  })
  .strict();

const resultListBaseItemSchema = z
  .object({
    id: z.string(),
    title: z.string(),
    summary: z.string().nullable().optional(),
    statusLabel: z.string().nullable().optional(),
    statusTone: z
      .enum(["neutral", "info", "success", "warning", "danger", "muted"])
      .nullable()
      .optional(),
    groupId: z.string().nullable().optional(),
    meta: z.array(resultListMetaItemSchema).max(8).optional(),
    evidence: z.array(resultListEvidenceSchema).max(4).optional(),
    primaryActionId: z.string().nullable().optional(),
    secondaryActionId: z.string().nullable().optional(),
  })
  .strict();

const resultListItemSchema = z.discriminatedUnion("variant", [
  resultListBaseItemSchema
    .extend({
      variant: z.literal("workItem"),
      priorityLabel: z.string().nullable().optional(),
      ownerLabel: z.string().nullable().optional(),
      dueLabel: z.string().nullable().optional(),
    })
    .strict(),
  resultListBaseItemSchema
    .extend({
      variant: z.literal("question"),
      required: z.boolean().optional(),
      answerLabel: z.string().nullable().optional(),
    })
    .strict(),
  resultListBaseItemSchema
    .extend({
      variant: z.literal("review"),
      reviewerLabel: z.string().nullable().optional(),
      recommendationLabel: z.string().nullable().optional(),
    })
    .strict(),
  resultListBaseItemSchema
    .extend({
      variant: z.literal("genericSummary"),
      sourceLabel: z.string().nullable().optional(),
    })
    .strict(),
]);

export const threadJsonRenderSchema = defineSchema((schema) => ({
  spec: schema.object({
    root: schema.string(),
    elements: schema.record(
      schema.object({
        type: schema.ref("catalog.components"),
        props: schema.propsOf("catalog.components"),
        children: schema.array(schema.string()),
      }),
    ),
  }),
  catalog: schema.object({
    components: schema.map({ props: schema.zod() }),
    actions: schema.map({ params: schema.zod() }),
  }),
}));

export const threadJsonRenderDomainComponentDefinitions = {
  "task.review": {
    props: z
      .object({
        title: z.string(),
        summary: z.string(),
        status: z.enum(["pending", "approved", "rejected", "needs_review"]),
        priority: z.string().nullable().optional(),
        assigneeLabel: z.string().nullable().optional(),
        primaryActionId: z.string().nullable().optional(),
      })
      .strict(),
    slots: ["default"],
    description: "ThinkWork task review and approval surface.",
    example: {
      title: "Review onboarding task",
      summary: "Confirm the customer kickoff task is ready.",
      status: "pending",
    },
  },
  "workflow.status": {
    props: z
      .object({
        title: z.string(),
        status: z.enum(["queued", "running", "blocked", "completed", "failed"]),
        steps: z
          .array(
            z
              .object({
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
              })
              .strict(),
          )
          .optional(),
      })
      .strict(),
    slots: ["default"],
    description: "ThinkWork workflow status summary.",
    example: {
      title: "Onboarding workflow",
      status: "running",
    },
  },
  "keyValue.list": {
    props: z
      .object({
        title: z.string().optional(),
        items: z.array(resultListMetaItemSchema),
      })
      .strict(),
    slots: ["default"],
    description: "Compact key/value list for generated Thread summaries.",
    example: {
      title: "Customer facts",
      items: [{ label: "Status", value: "Ready" }],
    },
  },
  "form.action": {
    props: z
      .object({
        title: z.string(),
        description: z.string().optional(),
        fields: z
          .array(
            z
              .object({
                id: z.string(),
                label: z.string(),
                type: z.enum(["text", "textarea", "select", "checkbox"]),
                required: z.boolean().optional(),
                options: z.array(z.string()).optional(),
              })
              .strict(),
          )
          .optional(),
        submitActionId: z.string().nullable().optional(),
      })
      .strict(),
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
  "result.list": {
    props: z
      .object({
        title: z.string(),
        summary: z.string().nullable().optional(),
        groups: z
          .array(
            z
              .object({
                id: z.string(),
                title: z.string(),
                summary: z.string().nullable().optional(),
              })
              .strict(),
          )
          .max(8)
          .optional(),
        items: z.array(resultListItemSchema).max(40),
        emptyState: z
          .object({
            title: z.string(),
            summary: z.string().nullable().optional(),
          })
          .strict()
          .optional(),
      })
      .strict(),
    slots: ["default"],
    description:
      "Structured ThinkWork result list for work items, questions, reviews, and generic summaries.",
    example: {
      title: "Work items",
      items: [
        {
          id: "wi-1",
          variant: "workItem",
          title: "Approve launch task",
          statusLabel: "Ready",
        },
      ],
    },
  },
} as const;

export type ThreadJsonRenderDomainComponent =
  keyof typeof threadJsonRenderDomainComponentDefinitions;

export const threadJsonRenderDomainComponentNames = Object.keys(
  threadJsonRenderDomainComponentDefinitions,
) as ThreadJsonRenderDomainComponent[];

export const threadJsonRenderPrimitiveComponentDefinitions =
  shadcnComponentDefinitions;

export const threadJsonRenderPrimitiveComponentNames = Object.keys(
  threadJsonRenderPrimitiveComponentDefinitions,
);

export const threadJsonRenderLocalActionDefinitions = {};

export const threadJsonRenderComponentDefinitions = {
  ...threadJsonRenderPrimitiveComponentDefinitions,
  ...threadJsonRenderDomainComponentDefinitions,
};

export const threadJsonRenderComponentNames = Object.keys(
  threadJsonRenderComponentDefinitions,
);

export const threadJsonRenderCatalog = defineCatalog(threadJsonRenderSchema, {
  components: threadJsonRenderComponentDefinitions,
  actions: threadJsonRenderLocalActionDefinitions,
});
