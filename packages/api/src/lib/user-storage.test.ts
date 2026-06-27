import { beforeEach, describe, expect, it, vi } from "vitest";

const retainMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({}),
}));

vi.mock("@thinkwork/database-pg/schema", () => ({
  wikiPages: {
    id: "wiki_pages.id",
    tenant_id: "wiki_pages.tenant_id",
    owner_id: "wiki_pages.owner_id",
    type: "wiki_pages.type",
    slug: "wiki_pages.slug",
  },
}));

vi.mock("./memory/index.js", () => ({
  getMemoryServices: () => ({
    adapter: {
      retain: retainMock,
    },
  }),
}));

import { writeUserMemorySeed } from "./user-storage.js";

describe("writeUserMemorySeed", () => {
  beforeEach(() => {
    retainMock.mockReset();
  });

  it("maps friction activation seeds to the legal Hindsight opinion fact type", async () => {
    await writeUserMemorySeed({
      tenantId: "tenant-1",
      userId: "11111111-1111-4111-8111-111111111111",
      layer: "friction",
      content: "User prefers short, direct status updates.",
      metadata: {
        sourceRunId: "activation-run-1",
      },
    });

    expect(retainMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "11111111-1111-4111-8111-111111111111",
      sourceType: "explicit_remember",
      content: "User prefers short, direct status updates.",
      metadata: {
        sourceRunId: "activation-run-1",
        source: "activation",
        layer: "friction",
        fact_type_override: "opinion",
      },
    });
  });

  it("omits fact-type override for non-friction activation seeds", async () => {
    await writeUserMemorySeed({
      tenantId: "tenant-1",
      userId: "11111111-1111-4111-8111-111111111111",
      layer: "profile",
      summary: "User works on enterprise memory architecture.",
      metadata: {
        fact_type_override: "semantic",
        sourceRunId: "activation-run-2",
      },
    });

    expect(retainMock).toHaveBeenCalledWith({
      tenantId: "tenant-1",
      ownerType: "user",
      ownerId: "11111111-1111-4111-8111-111111111111",
      sourceType: "explicit_remember",
      content: "User works on enterprise memory architecture.",
      metadata: {
        sourceRunId: "activation-run-2",
        source: "activation",
        layer: "profile",
      },
    });
  });
});
