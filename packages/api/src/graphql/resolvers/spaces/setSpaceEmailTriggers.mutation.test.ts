import { beforeEach, describe, expect, it, vi } from "vitest";

const {
  authCalls,
  copyCalls,
  cleanupCopiedKeyCalls,
  deleteCalls,
  updateSets,
  updateRows,
  executeCalls,
  selectRows,
  resetMocks,
} = vi.hoisted(() => {
  const authCalls: unknown[] = [];
  const copyCalls: unknown[] = [];
  const cleanupCopiedKeyCalls: unknown[] = [];
  const deleteCalls: unknown[] = [];
  const updateSets: unknown[] = [];
  const updateRows: unknown[][] = [];
  const executeCalls: unknown[] = [];
  const selectRows: unknown[][] = [];
  return {
    authCalls,
    copyCalls,
    cleanupCopiedKeyCalls,
    deleteCalls,
    updateSets,
    updateRows,
    executeCalls,
    selectRows,
    resetMocks: () => {
      authCalls.length = 0;
      copyCalls.length = 0;
      cleanupCopiedKeyCalls.length = 0;
      deleteCalls.length = 0;
      updateSets.length = 0;
      updateRows.length = 0;
      executeCalls.length = 0;
      selectRows.length = 0;
      selectRows.push([
        {
          id: "space-1",
          tenant_id: "tenant-1",
          slug: "finance",
          email_trigger_status: "enabled",
        },
      ]);
      selectRows.push([{ slug: "acme" }]);
    },
  };
});

vi.mock("../../utils.js", () => {
  const col = (name: string) => ({ name });
  function defaultUpdatedRow(updates: Record<string, unknown>) {
    return {
      id: "space-1",
      tenant_id: "tenant-1",
      slug: updates.slug ?? "finance",
      name: "Finance",
      status: "active",
      kind: "custom",
      access_mode: "private",
      email_trigger_status: updates.email_trigger_status,
      email_triggers_enabled: updates.email_triggers_enabled,
      updated_at: updates.updated_at,
    };
  }
  const dbMock = {
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(selectRows.shift() ?? []),
      }),
    }),
    update: () => ({
      set: (updates: Record<string, unknown>) => {
        updateSets.push(updates);
        return {
          where: () => ({
            returning: () =>
              Promise.resolve(
                updateRows.shift() ?? [defaultUpdatedRow(updates)],
              ),
          }),
        };
      },
    }),
    execute: (query: unknown) => {
      executeCalls.push(query);
      return Promise.resolve([]);
    },
    transaction: async (callback: (tx: unknown) => unknown) => callback(dbMock),
  };
  return {
    spaces: {
      id: col("spaces.id"),
      tenant_id: col("spaces.tenant_id"),
      slug: col("spaces.slug"),
      email_trigger_status: col("spaces.email_trigger_status"),
    },
    tenants: {
      id: col("tenants.id"),
      slug: col("tenants.slug"),
    },
    db: dbMock,
    and: (...items: unknown[]) => ({ and: items }),
    eq: (left: unknown, right: unknown) => ({ eq: [left, right] }),
    ne: (left: unknown, right: unknown) => ({ ne: [left, right] }),
    sql: (strings: TemplateStringsArray, ...values: unknown[]) => ({
      sql: strings.join("?"),
      values,
    }),
    snakeToCamel: (row: Record<string, unknown>) =>
      Object.fromEntries(
        Object.entries(row).map(([key, value]) => [
          key.replace(/_([a-z])/g, (_, char) => char.toUpperCase()),
          value,
        ]),
      ),
  };
});

vi.mock("../core/authz.js", () => ({
  requireAdminOrServiceCaller: (...args: unknown[]) => {
    authCalls.push(args);
    return Promise.resolve();
  },
}));

vi.mock("../../../lib/spaces/space-source-prefix-rename.js", () => ({
  copySpaceSourcePrefix: (input: unknown) => {
    copyCalls.push(input);
    return Promise.resolve({
      copied: 1,
      copiedKeys: ["tenants/acme/spaces/customer-success/AGENTS.md"],
      total: 1,
    });
  },
  deleteSpaceSourceKeys: (input: unknown) => {
    cleanupCopiedKeyCalls.push(input);
    return Promise.resolve({ deleted: 1, failures: [] });
  },
  deleteSpaceSourcePrefix: (input: unknown) => {
    deleteCalls.push(input);
    return Promise.resolve({ deleted: 1, failures: [] });
  },
}));

describe("setSpaceEmailTriggers", () => {
  beforeEach(() => {
    resetMocks();
  });

  it("requires admin access to the Space tenant before enabling email triggers", async () => {
    const { setSpaceEmailTriggers } =
      await import("./setSpaceEmailTriggers.mutation.js");

    const result = await setSpaceEmailTriggers(
      null,
      { spaceId: "space-1", enabled: true },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "set_space_email_triggers",
    ]);
    expect(updateSets[0]).toMatchObject({
      email_trigger_status: "enabled",
      email_triggers_enabled: true,
    });
    expect(updateSets[0]).toHaveProperty("updated_at");
    expect(result).toMatchObject({
      id: "space-1",
      accessMode: "PRIVATE",
      emailTriggerStatus: "ENABLED",
      emailTriggersEnabled: true,
    });
  });

  it("maps the compatibility false toggle to a disabled visible trigger", async () => {
    const { setSpaceEmailTriggers } =
      await import("./setSpaceEmailTriggers.mutation.js");

    const result = await setSpaceEmailTriggers(
      null,
      { spaceId: "space-1", enabled: false },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updateSets[0]).toMatchObject({
      email_trigger_status: "disabled",
      email_triggers_enabled: false,
    });
    expect(result).toMatchObject({
      emailTriggerStatus: "DISABLED",
      emailTriggersEnabled: false,
    });
  });

  it("edits the Space email prefix after copying source files to the new slug prefix", async () => {
    selectRows.push([]);
    const { updateSpaceEmailTrigger } =
      await import("./setSpaceEmailTriggers.mutation.js");

    const result = await updateSpaceEmailTrigger(
      null,
      {
        input: {
          spaceId: "space-1",
          status: "ENABLED",
          emailPrefix: " Customer Success ",
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(authCalls[0]).toEqual([
      { auth: { authType: "cognito" } },
      "tenant-1",
      "update_space_email_trigger",
    ]);
    expect(copyCalls).toEqual([
      {
        tenantSlug: "acme",
        oldSpaceSlug: "finance",
        newSpaceSlug: "customer-success",
      },
      {
        tenantSlug: "acme",
        oldSpaceSlug: "finance",
        newSpaceSlug: "customer-success",
        mode: "overwrite",
      },
    ]);
    expect(executeCalls).toHaveLength(1);
    expect(updateSets[0]).toMatchObject({
      slug: "customer-success",
      email_trigger_status: "enabled",
      email_triggers_enabled: true,
    });
    expect(deleteCalls).toEqual([
      {
        tenantSlug: "acme",
        oldSpaceSlug: "finance",
      },
    ]);
    expect(result).toMatchObject({
      slug: "customer-success",
      emailTriggerStatus: "ENABLED",
    });
  });

  it("cleans up copied destination keys when the slug update fails", async () => {
    selectRows.push([]);
    updateRows.push([]);
    const { updateSpaceEmailTrigger } =
      await import("./setSpaceEmailTriggers.mutation.js");

    await expect(
      updateSpaceEmailTrigger(
        null,
        {
          input: {
            spaceId: "space-1",
            status: "ENABLED",
            emailPrefix: "Customer Success",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space not found");

    expect(cleanupCopiedKeyCalls).toEqual([
      {
        keys: ["tenants/acme/spaces/customer-success/AGENTS.md"],
      },
    ]);
    expect(deleteCalls).toEqual([]);
  });

  it("deletes lifecycle state without changing slug or touching S3", async () => {
    const { updateSpaceEmailTrigger } =
      await import("./setSpaceEmailTriggers.mutation.js");

    const result = await updateSpaceEmailTrigger(
      null,
      {
        input: {
          spaceId: "space-1",
          status: "NONE",
        },
      },
      { auth: { authType: "cognito" } } as any,
    );

    expect(updateSets[0]).toMatchObject({
      email_trigger_status: "none",
      email_triggers_enabled: false,
    });
    expect(updateSets[0]).not.toHaveProperty("slug");
    expect(copyCalls).toEqual([]);
    expect(deleteCalls).toEqual([]);
    expect(result).toMatchObject({
      emailTriggerStatus: "NONE",
      emailTriggersEnabled: false,
    });
  });

  it("rejects deleting and editing the prefix in the same request", async () => {
    const { updateSpaceEmailTrigger } =
      await import("./setSpaceEmailTriggers.mutation.js");

    await expect(
      updateSpaceEmailTrigger(
        null,
        {
          input: {
            spaceId: "space-1",
            status: "NONE",
            emailPrefix: "customer",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Cannot edit email prefix while deleting trigger");
    expect(updateSets).toEqual([]);
  });

  it("rejects blank and invalid email trigger updates", async () => {
    const { updateSpaceEmailTrigger } =
      await import("./setSpaceEmailTriggers.mutation.js");

    await expect(
      updateSpaceEmailTrigger(
        null,
        {
          input: {
            spaceId: "space-1",
            status: "ENABLED",
            emailPrefix: " !!! ",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space email prefix is required");

    await expect(
      updateSpaceEmailTrigger(
        null,
        {
          input: {
            spaceId: "space-1",
            status: "BROKEN",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Invalid email trigger status");
  });

  it("rejects duplicate tenant-local email prefixes before copying files", async () => {
    selectRows.push([{ id: "space-2" }]);
    const { updateSpaceEmailTrigger } =
      await import("./setSpaceEmailTriggers.mutation.js");

    await expect(
      updateSpaceEmailTrigger(
        null,
        {
          input: {
            spaceId: "space-1",
            status: "ENABLED",
            emailPrefix: " Customer Success ",
          },
        },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space email prefix is already in use");
    expect(copyCalls).toEqual([]);
    expect(updateSets).toEqual([]);
  });

  it("rejects unknown Spaces before authorizing against a tenant", async () => {
    selectRows.length = 0;
    selectRows.push([]);

    const { setSpaceEmailTriggers } =
      await import("./setSpaceEmailTriggers.mutation.js");

    await expect(
      setSpaceEmailTriggers(
        null,
        { spaceId: "missing-space", enabled: false },
        { auth: { authType: "cognito" } } as any,
      ),
    ).rejects.toThrow("Space not found");
    expect(authCalls).toEqual([]);
    expect(updateSets).toEqual([]);
  });
});
