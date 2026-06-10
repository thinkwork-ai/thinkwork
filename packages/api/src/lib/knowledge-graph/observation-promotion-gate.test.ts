import { describe, expect, it, vi } from "vitest";

import {
  applyPromotionGate,
  containsSecretShapedContent,
  type GateCandidate,
} from "./observation-promotion-gate.js";

const TENANT_USER = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";

function candidate(overrides: Partial<GateCandidate>): GateCandidate {
  return {
    id: "00000000-0000-0000-0000-00000000000a",
    bankId: `user_${TENANT_USER}`,
    userId: TENANT_USER,
    text: "Acme Corp renewed their annual contract",
    sourceMemoryIds: ["00000000-0000-0000-0000-0000000000f1"],
    ...overrides,
  };
}

/**
 * Fake Database: first execute resolves proof units (id → threadId), second
 * resolves shared threads. Tests drive both via queued results.
 */
function fakeDb(results: Array<{ rows: unknown[] }>) {
  const execute = vi.fn();
  for (const result of results) execute.mockResolvedValueOnce(result);
  execute.mockResolvedValue({ rows: [] });
  return { execute } as any;
}

const allInstitutional = async (items: Array<{ id: string; text: string }>) =>
  new Map(items.map((item) => [item.id, "institutional" as const]));

describe("containsSecretShapedContent", () => {
  it("flags credential-shaped content", () => {
    expect(containsSecretShapedContent("key AKIAIOSFODNN7EXAMPLE")).toBe(true);
    expect(
      containsSecretShapedContent("token ghp_abcdefghijklmnopqrstuvwxyz012345"),
    ).toBe(true);
    expect(containsSecretShapedContent("password: hunter2hunter2hunter2")).toBe(
      true,
    );
  });

  it("passes ordinary business prose", () => {
    expect(
      containsSecretShapedContent(
        "Acme Corp prefers quarterly invoicing and net-30 terms",
      ),
    ).toBe(false);
  });
});

describe("applyPromotionGate", () => {
  it("promotes institutional observations with shared-thread proofs", async () => {
    const db = fakeDb([
      {
        rows: [
          {
            id: "00000000-0000-0000-0000-0000000000f1",
            thread_id: "11111111-0000-0000-0000-000000000001",
          },
        ],
      },
      { rows: [{ id: "11111111-0000-0000-0000-000000000001" }] },
    ]);
    const result = await applyPromotionGate([candidate({})], {
      db,
      classify: allInstitutional,
    });
    expect(result.promoted).toHaveLength(1);
    expect(result.excluded).toHaveLength(0);
    expect(result.audit.promotedIds).toEqual([
      "00000000-0000-0000-0000-00000000000a",
    ]);
  });

  it("structurally excludes proofs from non-shared threads before the classifier", async () => {
    const classify = vi.fn(allInstitutional);
    const db = fakeDb([
      {
        rows: [
          {
            id: "00000000-0000-0000-0000-0000000000f1",
            thread_id: "11111111-0000-0000-0000-000000000002",
          },
        ],
      },
      { rows: [] }, // thread not in any active public space
    ]);
    const result = await applyPromotionGate([candidate({})], { db, classify });
    expect(result.promoted).toHaveLength(0);
    expect(result.excluded).toEqual([
      {
        id: "00000000-0000-0000-0000-00000000000a",
        reason: "non_shared_context",
      },
    ]);
    expect(classify).not.toHaveBeenCalled();
  });

  it("passes proofs without thread context to the classifier", async () => {
    const db = fakeDb([
      {
        rows: [{ id: "00000000-0000-0000-0000-0000000000f1", thread_id: null }],
      },
    ]);
    const result = await applyPromotionGate([candidate({})], {
      db,
      classify: allInstitutional,
    });
    expect(result.promoted).toHaveLength(1);
  });

  it("excludes credential-shaped content regardless of classification", async () => {
    const db = fakeDb([
      {
        rows: [{ id: "00000000-0000-0000-0000-0000000000f1", thread_id: null }],
      },
    ]);
    const result = await applyPromotionGate(
      [candidate({ text: "deploy key AKIAIOSFODNN7EXAMPLE in use" })],
      { db, classify: allInstitutional },
    );
    expect(result.promoted).toHaveLength(0);
    expect(result.excluded[0]?.reason).toBe("secret_scan");
  });

  it("excludes personal verdicts and defaults missing verdicts to excluded", async () => {
    const personal = candidate({
      id: "00000000-0000-0000-0000-00000000000b",
      text: "Bob is stressed about his manager",
    });
    const unverified = candidate({
      id: "00000000-0000-0000-0000-00000000000c",
      text: "Some other fact",
    });
    const db = fakeDb([
      {
        rows: [{ id: "00000000-0000-0000-0000-0000000000f1", thread_id: null }],
      },
    ]);
    const result = await applyPromotionGate([personal, unverified], {
      db,
      // Verdict for one item only; the other is missing (count mismatch).
      classify: async () =>
        new Map([
          ["00000000-0000-0000-0000-00000000000b", "personal" as const],
        ]),
    });
    expect(result.promoted).toHaveLength(0);
    expect(result.audit.excludedCounts.classified_personal).toBe(1);
    expect(result.audit.excludedCounts.classifier_unverifiable).toBe(1);
  });

  it("records the pinned classifier identity in the audit", async () => {
    const db = fakeDb([{ rows: [] }]);
    const result = await applyPromotionGate([], { db });
    expect(result.audit.classifierModelId).toBeTruthy();
    expect(result.audit.classifierPromptVersion).toBe("v1");
  });
});
