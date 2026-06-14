/**
 * Per-tenant skill-update gate threshold tests (Skill Tests & Evals U6).
 *
 * The `db` is a chain-recording fake: get → select chain returning the
 * queued row, set (finite threshold) → insert/onConflictDoUpdate, clear
 * (null) → delete. Range validation throws BEFORE any write.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { selectQueue, insertValues, upsertSets, deleteWheres, resetState } =
  vi.hoisted(() => {
    const selectQueue: unknown[][] = [];
    const insertValues: unknown[] = [];
    const upsertSets: unknown[] = [];
    const deleteWheres: unknown[] = [];
    return {
      selectQueue,
      insertValues,
      upsertSets,
      deleteWheres,
      resetState: () => {
        selectQueue.length = 0;
        insertValues.length = 0;
        upsertSets.length = 0;
        deleteWheres.length = 0;
      },
    };
  });

vi.mock("../../graphql/utils.js", () => {
  const makeSelectChain = () => {
    const chain: any = {};
    chain.from = () => chain;
    chain.where = () => chain;
    chain.limit = () => chain;
    chain.then = (
      resolve: (rows: unknown[]) => unknown,
      reject: (err: unknown) => unknown,
    ) => Promise.resolve(selectQueue.shift() ?? []).then(resolve, reject);
    return chain;
  };
  return {
    db: {
      select: () => makeSelectChain(),
      insert: () => ({
        values: (v: unknown) => {
          insertValues.push(v);
          return {
            onConflictDoUpdate: (cfg: { set: unknown }) => {
              upsertSets.push(cfg.set);
              return Promise.resolve();
            },
          };
        },
      }),
      delete: () => ({
        where: (clause: unknown) => {
          deleteWheres.push(clause);
          return Promise.resolve();
        },
      }),
    },
    eq: (...args: unknown[]) => ({ eq: args }),
    sql: (...args: unknown[]) => ({ sql: args }),
  };
});

vi.mock("@thinkwork/database-pg/schema", () => ({
  evalSkillGate: {
    tenant_id: "gate.tenant_id",
    threshold: "gate.threshold",
    updated_at: "gate.updated_at",
  },
}));

import {
  getSkillEvalGateThreshold,
  setSkillEvalGateThreshold,
} from "./skill-eval-gate.js";

beforeEach(() => {
  vi.clearAllMocks();
  resetState();
});

describe("getSkillEvalGateThreshold", () => {
  it("returns null when no gate row exists", async () => {
    selectQueue.push([]);
    expect(await getSkillEvalGateThreshold("tenant-1")).toBeNull();
  });

  it("coerces the numeric(5,4) string to a number", async () => {
    selectQueue.push([{ threshold: "0.7500" }]);
    expect(await getSkillEvalGateThreshold("tenant-1")).toBe(0.75);
  });

  it("returns null when the row's threshold is null", async () => {
    selectQueue.push([{ threshold: null }]);
    expect(await getSkillEvalGateThreshold("tenant-1")).toBeNull();
  });
});

describe("setSkillEvalGateThreshold", () => {
  it("upserts a finite threshold as a fixed-precision string", async () => {
    await setSkillEvalGateThreshold("tenant-1", 0.8);
    expect(insertValues).toHaveLength(1);
    expect(insertValues[0]).toMatchObject({
      tenant_id: "tenant-1",
      threshold: "0.8000",
    });
    expect(upsertSets).toHaveLength(1);
    expect(upsertSets[0]).toMatchObject({ threshold: "0.8000" });
    expect(deleteWheres).toHaveLength(0);
  });

  it("upserts the boundary values 0 and 1", async () => {
    await setSkillEvalGateThreshold("tenant-1", 0);
    await setSkillEvalGateThreshold("tenant-1", 1);
    expect((insertValues[0] as Record<string, unknown>).threshold).toBe(
      "0.0000",
    );
    expect((insertValues[1] as Record<string, unknown>).threshold).toBe(
      "1.0000",
    );
  });

  it("DELETEs the row when threshold is null (clears the gate)", async () => {
    await setSkillEvalGateThreshold("tenant-1", null);
    expect(deleteWheres).toHaveLength(1);
    expect(insertValues).toHaveLength(0);
    expect(upsertSets).toHaveLength(0);
  });

  it("throws on a below-range threshold without writing", async () => {
    await expect(setSkillEvalGateThreshold("tenant-1", -0.1)).rejects.toThrow(
      /\[0, 1\]/,
    );
    expect(insertValues).toHaveLength(0);
    expect(upsertSets).toHaveLength(0);
  });

  it("throws on an above-range threshold without writing", async () => {
    await expect(setSkillEvalGateThreshold("tenant-1", 1.5)).rejects.toThrow(
      /\[0, 1\]/,
    );
    expect(insertValues).toHaveLength(0);
  });

  it("throws on NaN/Infinity without writing", async () => {
    await expect(
      setSkillEvalGateThreshold("tenant-1", Number.NaN),
    ).rejects.toThrow();
    await expect(
      setSkillEvalGateThreshold("tenant-1", Number.POSITIVE_INFINITY),
    ).rejects.toThrow();
    expect(insertValues).toHaveLength(0);
  });
});
