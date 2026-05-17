import { describe, expect, it } from "vitest";
import { OntologyChangeSetStatus } from "@/gql/graphql";
import {
  changeSetDraftFromChangeSet,
  itemDraftFromItem,
  parseEditedValueInput,
  sortChangeSets,
  statusTone,
  stringifyJsonValue,
} from "./ontology";

const baseChangeSet = {
  id: "cs_1",
  title: "Add account health",
  summary: "Repeated account health references need a durable type.",
  status: OntologyChangeSetStatus.PendingReview,
  confidence: 0.82,
  observedFrequency: 14,
  expectedImpact: { affectedPages: 9 },
  proposedBy: "scan",
  approvedAt: null,
  rejectedAt: null,
  appliedVersionId: null,
  createdAt: "2026-05-17T10:00:00.000Z",
  updatedAt: "2026-05-17T11:00:00.000Z",
  evidenceExamples: [],
  items: [],
};

const baseItem = {
  id: "item_1",
  itemType: "ENTITY_TYPE",
  action: "CREATE",
  status: OntologyChangeSetStatus.PendingReview,
  targetKind: "entity_type",
  targetSlug: "account-health",
  title: "Account Health",
  description: "A customer-account health state.",
  proposedValue: {
    name: "Account Health",
    guidanceNotes: "Use for health snapshots, not support tickets.",
  },
  editedValue: null,
  confidence: 0.9,
  position: 0,
  evidenceExamples: [],
};

describe("ontology change-set helpers", () => {
  it("initializes editable drafts from proposed ontology payloads", () => {
    expect(changeSetDraftFromChangeSet(baseChangeSet)).toEqual({
      title: "Add account health",
      summary: "Repeated account health references need a durable type.",
    });
    const draft = itemDraftFromItem(baseItem);
    expect(draft.status).toBe(OntologyChangeSetStatus.PendingReview);
    expect(JSON.parse(draft.editedValueInput)).toEqual(baseItem.proposedValue);
  });

  it("preserves reviewer edits as parsed JSON and reports invalid JSON", () => {
    expect(parseEditedValueInput('{"name":"Customer Risk"}')).toEqual({
      ok: true,
      value: { name: "Customer Risk" },
    });
    expect(parseEditedValueInput("{nope").ok).toBe(false);
    expect(stringifyJsonValue({ mappings: ["schema:Organization"] })).toContain(
      "schema:Organization",
    );
  });

  it("orders review-ready change sets ahead of approved and rejected history", () => {
    const sorted = sortChangeSets([
      {
        ...baseChangeSet,
        id: "rejected",
        status: OntologyChangeSetStatus.Rejected,
      },
      {
        ...baseChangeSet,
        id: "draft",
        status: OntologyChangeSetStatus.Draft,
      },
      {
        ...baseChangeSet,
        id: "approved",
        status: OntologyChangeSetStatus.Approved,
      },
    ]);
    expect(sorted.map((changeSet) => changeSet.id)).toEqual([
      "draft",
      "approved",
      "rejected",
    ]);
  });

  it("uses distinct tones for review, success, and failure states", () => {
    expect(statusTone(OntologyChangeSetStatus.PendingReview)).toContain("blue");
    expect(statusTone(OntologyChangeSetStatus.Approved)).toContain("green");
    expect(statusTone(OntologyChangeSetStatus.Rejected)).toContain(
      "destructive",
    );
  });
});
