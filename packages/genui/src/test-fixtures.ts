import { createThreadGenUISpecHash } from "./hash.js";
import {
  THREAD_GENUI_CATALOG_VERSION,
  THREAD_GENUI_PART_TYPE,
  THREAD_GENUI_SCHEMA_VERSION,
  type ThreadGenUIPart,
} from "./spec.js";

export function createTaskReviewGenUIFixture(): ThreadGenUIPart {
  const spec = {
    root: "review",
    elements: {
      review: {
        component: "task.review",
        props: {
          title: "Review onboarding task",
          summary: "Confirm the customer kickoff task is ready to approve.",
          status: "pending",
          primaryActionId: "approve-task",
        },
      },
    },
  } satisfies ThreadGenUIPart["data"]["spec"];

  return {
    type: THREAD_GENUI_PART_TYPE,
    id: "genui:task-review:123",
    data: {
      schemaVersion: THREAD_GENUI_SCHEMA_VERSION,
      catalogVersion: THREAD_GENUI_CATALOG_VERSION,
      spec,
      status: "ready",
      actions: [
        {
          id: "approve-task",
          label: "Approve",
          kind: "approve",
          params: { taskId: "task-123" },
        },
      ],
      mobileFallback: {
        title: "Review onboarding task",
        summary: "Confirm the customer kickoff task is ready to approve.",
        lines: ["Status: pending"],
      },
      promotion: {
        artifactTitle: "Onboarding task review",
        artifactSummary: "Snapshot of the generated task review.",
      },
      specHash: createThreadGenUISpecHash(spec),
    },
  };
}
