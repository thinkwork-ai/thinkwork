/**
 * THINK-220 focused proof: a representative Hindsight-touching query in the
 * memory-retain handler (`countExtractedUnitsForThread`) flips schema qualifier
 * and execution handle with `HINDSIGHT_DATABASE_NAME`.
 *
 *   - unset: SQL contains `hindsight.memory_units`, executes on getDb()'s
 *     handle (getHindsightDb() === getDb() until cutover).
 *   - set:   SQL contains `public.memory_units`, executes on the dedicated
 *     getHindsightDb() handle, NOT the primary getDb() handle.
 *
 * getDb and getHindsightDb are wired to DISTINCT spies here so routing is
 * observable; hindsightSql is the real seam (reads env at call time).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const primaryExecute = vi.hoisted(() => vi.fn());
const hindsightExecute = vi.hoisted(() => vi.fn());

vi.mock("@thinkwork/database-pg", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@thinkwork/database-pg")>();
  return {
    getDb: () => ({ execute: primaryExecute }),
    getHindsightDb: () => ({ execute: hindsightExecute }),
    resolveHindsightDb: <T>(primary: T) => primary,
    // Real chunk: renders `hindsight.` (env unset) or `public.` (env set).
    hindsightSql: actual.hindsightSql,
  };
});

// Unrelated collaborators pulled in by the handler module; stub to no-ops.
vi.mock("../lib/memory/index.js", () => ({ getMemoryServices: vi.fn() }));
vi.mock("../lib/user-context-md-writer.js", () => ({
  writeUserContextMdForUser: vi.fn(),
}));

import { countExtractedUnitsForThread } from "./memory-retain.js";

const THREAD_ID = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

function renderedSql(call: unknown): string {
  return JSON.stringify(
    (call as { queryChunks?: unknown[] })?.queryChunks ?? call,
  );
}

describe("countExtractedUnitsForThread Hindsight seam", () => {
  beforeEach(() => {
    primaryExecute.mockReset().mockResolvedValue({ rows: [{ n: 3 }] });
    hindsightExecute.mockReset().mockResolvedValue({ rows: [{ n: 3 }] });
  });

  afterEach(() => {
    vi.unstubAllEnvs();
  });

  it("keeps hindsight.memory_units on the Hindsight handle when env unset", async () => {
    const count = await countExtractedUnitsForThread(THREAD_ID);
    expect(count).toBe(3);
    expect(hindsightExecute).toHaveBeenCalledTimes(1);
    const sql = renderedSql(hindsightExecute.mock.calls[0][0]);
    expect(sql).toContain("hindsight.");
    expect(sql).toContain("memory_units");
    expect(sql).not.toContain("public.");
  });

  it("flips to public.memory_units on the dedicated handle when env set", async () => {
    vi.stubEnv("HINDSIGHT_DATABASE_NAME", "thinkwork_hindsight");
    const count = await countExtractedUnitsForThread(THREAD_ID);
    expect(count).toBe(3);
    // Routed to the dedicated Hindsight handle, never the primary handle.
    expect(hindsightExecute).toHaveBeenCalledTimes(1);
    expect(primaryExecute).not.toHaveBeenCalled();
    const sql = renderedSql(hindsightExecute.mock.calls[0][0]);
    expect(sql).toContain("public.");
    expect(sql).toContain("memory_units");
    expect(sql).not.toContain("hindsight.");
  });
});
