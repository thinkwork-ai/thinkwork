/**
 * Eval Profile lifecycle tests (THINK-107 U2).
 *
 * Pins the lifecycle invariants: archive-default rejection, atomic
 * setDefault swap, get-or-create default synthesis (including the
 * lost-race read-back), trials validation, and unique-name translation.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { state, resetState } = vi.hoisted(() => {
  const state = {
    selectQueue: [] as unknown[][],
    inserted: [] as Record<string, unknown>[],
    insertShouldThrow: null as Error | null,
    updates: [] as { set: Record<string, unknown>; where: unknown }[],
    updateReturning: [] as unknown[][],
  };
  return {
    state,
    resetState: () => {
      state.selectQueue.length = 0;
      state.inserted.length = 0;
      state.insertShouldThrow = null;
      state.updates.length = 0;
      state.updateReturning.length = 0;
    },
  };
});

function makeDb() {
  const makeSelectChain = () => {
    const chain: any = {};
    for (const method of ["from", "where", "orderBy", "limit"]) {
      chain[method] = () => chain;
    }
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(state.selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  };
  const dbApi: any = {
    select: () => makeSelectChain(),
    insert: () => ({
      values: (values: Record<string, unknown>) => ({
        returning: () => {
          if (state.insertShouldThrow) {
            return Promise.reject(state.insertShouldThrow);
          }
          state.inserted.push(values);
          return Promise.resolve([
            {
              id: "profile-new",
              tenant_id: values.tenant_id,
              name: values.name,
              model: values.model,
              judge_model: values.judge_model ?? null,
              trials: values.trials ?? 1,
              is_default: values.is_default ?? false,
              archived_at: null,
              created_at: new Date("2026-07-01T00:00:00Z"),
              updated_at: new Date("2026-07-01T00:00:00Z"),
            },
          ]);
        },
      }),
    }),
    update: () => ({
      set: (set: Record<string, unknown>) => ({
        where: (where: unknown) => {
          const chain: any = {
            returning: () => {
              state.updates.push({ set, where });
              return Promise.resolve(state.updateReturning.shift() ?? []);
            },
          };
          // Non-returning awaits (the setDefault unset arm) resolve too.
          chain.then = (
            resolve: (v: unknown) => unknown,
            reject: (err: unknown) => unknown,
          ) => {
            state.updates.push({ set, where });
            return Promise.resolve([]).then(resolve, reject);
          };
          return chain;
        },
      }),
    }),
    transaction: async (cb: (tx: unknown) => Promise<unknown>) => cb(dbApi),
  };
  return dbApi;
}

vi.mock("../../graphql/utils.js", () => ({
  db: makeDb(),
  eq: (...args: unknown[]) => ({ eq: args }),
  and: (...args: unknown[]) => ({ and: args }),
  isNull: (arg: unknown) => ({ isNull: arg }),
  sql: () => "sql",
}));

vi.mock("./eval-defaults.js", () => ({
  DEFAULT_EVAL_MODEL_ID: "moonshotai.kimi-k2.5",
}));

import {
  EvalProfileError,
  archiveEvalProfile,
  createEvalProfile,
  getOrCreateDefaultEvalProfile,
  resolveEvalProfileForRun,
  setDefaultEvalProfile,
} from "./eval-profiles.js";

const profileRow = (overrides: Record<string, unknown> = {}) => ({
  id: "profile-1",
  tenant_id: "tenant-1",
  name: "Default",
  model: "moonshotai.kimi-k2.5",
  judge_model: null,
  trials: 1,
  is_default: false,
  archived_at: null,
  created_at: new Date("2026-07-01T00:00:00Z"),
  updated_at: new Date("2026-07-01T00:00:00Z"),
  ...overrides,
});

beforeEach(() => {
  resetState();
  vi.clearAllMocks();
});

describe("createEvalProfile", () => {
  it("creates with trimmed name and default trials", async () => {
    const row = await createEvalProfile({
      tenantId: "tenant-1",
      name: "  Candidate  ",
      model: "us.anthropic.claude-sonnet-5",
    });
    expect(row.name).toBe("Candidate");
    expect(state.inserted[0]).toMatchObject({
      tenant_id: "tenant-1",
      name: "Candidate",
      trials: 1,
      is_default: false,
    });
  });

  it("rejects out-of-range trials", async () => {
    await expect(
      createEvalProfile({
        tenantId: "tenant-1",
        name: "Bad",
        model: "m",
        trials: 0,
      }),
    ).rejects.toThrow(/trials must be an integer/);
  });

  it("translates the tenant+name unique violation", async () => {
    state.insertShouldThrow = new Error(
      'duplicate key value violates unique constraint "uq_eval_profiles_tenant_name"',
    );
    await expect(
      createEvalProfile({ tenantId: "tenant-1", name: "Default", model: "m" }),
    ).rejects.toThrow(/already exists/);
  });
});

describe("archiveEvalProfile", () => {
  it("rejects archiving the current default", async () => {
    state.selectQueue.push([profileRow({ is_default: true })]);
    await expect(archiveEvalProfile("profile-1")).rejects.toThrow(
      /default profile cannot be archived/,
    );
  });

  it("is idempotent on an already-archived profile", async () => {
    const archived = profileRow({ archived_at: new Date() });
    state.selectQueue.push([archived]);
    const row = await archiveEvalProfile("profile-1");
    expect(row).toBe(archived);
    expect(state.updates.length).toBe(0);
  });

  it("archives a non-default profile", async () => {
    state.selectQueue.push([profileRow()]);
    state.updateReturning.push([profileRow({ archived_at: new Date() })]);
    const row = await archiveEvalProfile("profile-1");
    expect(row.archived_at).not.toBeNull();
  });
});

describe("setDefaultEvalProfile", () => {
  it("rejects an archived profile", async () => {
    state.selectQueue.push([profileRow({ archived_at: new Date() })]);
    await expect(setDefaultEvalProfile("profile-1")).rejects.toThrow(
      /archived profile cannot be the default/,
    );
  });

  it("short-circuits when already default", async () => {
    state.selectQueue.push([profileRow({ is_default: true })]);
    const row = await setDefaultEvalProfile("profile-1");
    expect(row.is_default).toBe(true);
    expect(state.updates.length).toBe(0);
  });

  it("unsets the old default then sets the new one", async () => {
    state.selectQueue.push([profileRow()]);
    state.updateReturning.push([profileRow({ is_default: true })]);
    const row = await setDefaultEvalProfile("profile-1");
    expect(row.is_default).toBe(true);
    // First update unsets (is_default: false), second sets.
    expect(state.updates[0]?.set).toMatchObject({ is_default: false });
    expect(state.updates[1]?.set).toMatchObject({ is_default: true });
  });
});

describe("getOrCreateDefaultEvalProfile", () => {
  it("returns the existing default without inserting", async () => {
    state.selectQueue.push([profileRow({ is_default: true })]);
    const row = await getOrCreateDefaultEvalProfile("tenant-1");
    expect(row.is_default).toBe(true);
    expect(state.inserted.length).toBe(0);
  });

  it("synthesizes a default when none exists (AE7)", async () => {
    state.selectQueue.push([]); // no default
    const row = await getOrCreateDefaultEvalProfile("tenant-1");
    expect(row.is_default).toBe(true);
    expect(state.inserted[0]).toMatchObject({
      tenant_id: "tenant-1",
      name: "Default",
      model: "moonshotai.kimi-k2.5",
      trials: 1,
      is_default: true,
    });
  });

  it("reads back the winner after losing a create race", async () => {
    state.selectQueue.push([]); // no default on first read
    state.insertShouldThrow = new Error(
      'duplicate key value violates unique constraint "uq_eval_profiles_tenant_default"',
    );
    state.selectQueue.push([profileRow({ is_default: true, id: "winner" })]);
    const row = await getOrCreateDefaultEvalProfile("tenant-1");
    expect(row.id).toBe("winner");
  });
});

describe("resolveEvalProfileForRun", () => {
  it("falls back to the default when no profileId given", async () => {
    state.selectQueue.push([profileRow({ is_default: true })]);
    const row = await resolveEvalProfileForRun("tenant-1", null);
    expect(row.is_default).toBe(true);
  });

  it("rejects a cross-tenant profile", async () => {
    state.selectQueue.push([profileRow({ tenant_id: "other-tenant" })]);
    await expect(
      resolveEvalProfileForRun("tenant-1", "profile-1"),
    ).rejects.toThrow(EvalProfileError);
  });

  it("rejects an archived profile for new runs", async () => {
    state.selectQueue.push([profileRow({ archived_at: new Date() })]);
    await expect(
      resolveEvalProfileForRun("tenant-1", "profile-1"),
    ).rejects.toThrow(/archived profile cannot be used/);
  });
});
