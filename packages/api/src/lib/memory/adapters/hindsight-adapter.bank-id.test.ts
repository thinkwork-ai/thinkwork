import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const executeMock = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    execute: executeMock,
  }),
}));

import { HindsightAdapter } from "./hindsight-adapter.js";

const USER_ID = "4dee701a-c17b-46fe-9f38-a333d4c3fad0";
const TENANT_ID = "0015953e-aa13-4cab-8398-2e70f73dda63";
const SPACE_ID = "c9f50dd6-5616-4812-b2ac-81b8d130f795";

describe("HindsightAdapter active Space bank ids", () => {
  beforeEach(() => {
    executeMock.mockReset();
  });

  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("recalls from the user bank and the non-default Space bank", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory_units: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "snowflake rotation",
      hindsight: {
        activeSpace: {
          spaceId: SPACE_ID,
          spaceSlug: "finance",
          isDefault: false,
        },
      },
    });

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/memories/recall`,
      `https://hindsight.example/v1/default/banks/space_${SPACE_ID}/memories/recall`,
    ]);
    expect(executeMock).not.toHaveBeenCalled();
  });

  it("omits the Space bank for the tenant default Space", async () => {
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory_units: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "default-space memory",
      hindsight: {
        activeSpace: {
          spaceId: SPACE_ID,
          spaceSlug: "default",
          isDefault: true,
        },
      },
    });

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/memories/recall`,
    ]);
  });

  it("keeps legacy fan-out while adding the active Space bank", async () => {
    executeMock.mockResolvedValueOnce({
      rows: [
        {
          id: "c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c",
          slug: "fleet-caterpillar-456",
          name: "Marco",
        },
      ],
    });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ memory_units: [] }),
    });
    vi.stubGlobal("fetch", fetchMock);

    const adapter = new HindsightAdapter({
      endpoint: "https://hindsight.example",
    });
    await adapter.recall({
      tenantId: TENANT_ID,
      ownerType: "user",
      ownerId: USER_ID,
      query: "legacy and space search",
      hindsight: {
        includeLegacyBanks: true,
        activeSpace: {
          spaceId: SPACE_ID,
          spaceSlug: "finance",
          isDefault: false,
        },
      },
    });

    expect(fetchMock.mock.calls.map((call) => String(call[0]))).toEqual([
      `https://hindsight.example/v1/default/banks/user_${USER_ID}/memories/recall`,
      `https://hindsight.example/v1/default/banks/space_${SPACE_ID}/memories/recall`,
      "https://hindsight.example/v1/default/banks/fleet-caterpillar-456/memories/recall",
      "https://hindsight.example/v1/default/banks/marco/memories/recall",
      "https://hindsight.example/v1/default/banks/c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c/memories/recall",
      "https://hindsight.example/v1/default/banks/user_c1e4434f-fa28-4ba2-bdd5-5d47f9d92e2c/memories/recall",
    ]);
  });
});
