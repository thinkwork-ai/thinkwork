/**
 * Tests for derive-agent-skills (Plan §008 U11).
 *
 * deriveAgentSkills is the file → DB direction: composed AGENTS.md
 * routing rows are unioned, deduped, and reconciled into the agent_skills
 * table. The mocks here keep both sides in scope:
 *   - composeList returns a curated list of composed entries (root +
 *     sub-agent folder AGENTS.md content) so we can drive parser inputs
 *     directly from the test.
 *   - db is a minimal queue-based mock whose select() pops the next
 *     queued row set, insert() / delete() record what would have run, and
 *     transaction() invokes the callback against a `tx` that mirrors the
 *     same surface.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

// ─── Hoisted mock state ──────────────────────────────────────────────────────

const { composeListMock, dbState, resetDbState } = vi.hoisted(() => {
  type DbState = {
    selectQueue: unknown[][];
    insertCalls: { values: unknown[]; conflictTarget?: unknown }[];
    deleteCalls: { where: unknown }[];
    transactionInvocations: number;
    failNextInsert: Error | null;
  };
  const dbState: DbState = {
    selectQueue: [],
    insertCalls: [],
    deleteCalls: [],
    transactionInvocations: 0,
    failNextInsert: null,
  };
  return {
    composeListMock: vi.fn(),
    dbState,
    resetDbState: () => {
      dbState.selectQueue = [];
      dbState.insertCalls = [];
      dbState.deleteCalls = [];
      dbState.transactionInvocations = 0;
      dbState.failNextInsert = null;
    },
  };
});

// ─── DB mock ─────────────────────────────────────────────────────────────────

vi.mock("../graphql/utils.js", () => {
  const tableCol = (label: string) => ({ __col: label });

  const selectChain = () => ({
    from: () => ({
      where: () =>
        Promise.resolve((dbState.selectQueue.shift() ?? []) as unknown[]),
    }),
  });

  const insertChain = (table: unknown) => ({
    values: (rows: unknown[]) => ({
      onConflictDoNothing: (opts?: unknown) => {
        dbState.insertCalls.push({ values: rows, conflictTarget: opts });
        if (dbState.failNextInsert) {
          const err = dbState.failNextInsert;
          dbState.failNextInsert = null;
          return Promise.reject(err);
        }
        return Promise.resolve();
      },
    }),
  });

  const deleteChain = (table: unknown) => ({
    where: (clause: unknown) => {
      dbState.deleteCalls.push({ where: clause });
      return Promise.resolve();
    },
  });

  const tx = {
    insert: vi.fn(insertChain),
    delete: vi.fn(deleteChain),
  };

  const db = {
    select: vi.fn(selectChain),
    insert: vi.fn(insertChain),
    delete: vi.fn(deleteChain),
    transaction: vi.fn(async (cb: (t: typeof tx) => unknown) => {
      dbState.transactionInvocations++;
      return cb(tx);
    }),
  };

  return {
    db,
    eq: (...args: unknown[]) => ({ __eq: args }),
    and: (...args: unknown[]) => ({ __and: args }),
    inArray: (col: unknown, values: unknown[]) => ({ __in: [col, values] }),
    agents: {
      id: tableCol("agents.id"),
      tenant_id: tableCol("agents.tenant_id"),
    },
    agentSkills: {
      agent_id: tableCol("agent_skills.agent_id"),
      skill_id: tableCol("agent_skills.skill_id"),
      tenant_id: tableCol("agent_skills.tenant_id"),
    },
  };
});

// Per docs/plans/2026-04-27-003: derive-agent-skills no longer routes
// through the composer. The mock variable is kept under its old name
// (composeListMock) for diff readability, but it is now injected via
// the new opts.readAgentsMdFiles seam — the shape (a list of
// {path, content} records) is unchanged.

// Imports after mocks.
// eslint-disable-next-line import/first
import { deriveAgentSkills } from "../lib/derive-agent-skills.js";

// U4 added a second reader for workspace/.../skills/<slug>/SKILL.md.
// These tests focus on AGENTS.md routing-derived skills; we inject an
// empty stub for the skill-md reader so the default S3-walk path
// doesn't run (it would error without WORKSPACE_BUCKET in test).
const deriveOpts = {
  readAgentsMdFiles: composeListMock,
  readSkillMdFiles: async () => [],
};

// ─── Helpers ─────────────────────────────────────────────────────────────────

const TENANT = "tenant-a";
const AGENT_ID = "agent-marco";

function ctx() {
  return { tenantId: TENANT };
}

function composedEntry(path: string, content: string) {
  return { path, content, source: "agent-override", sha256: "sha" };
}

const ROOT_AGENTS_MD = `# Marco

## Routing

| Task           | Go to       | Read                  | Skills                       |
| -------------- | ----------- | --------------------- | ---------------------------- |
| Expense work   | expenses/   | expenses/CONTEXT.md   | approve-receipt              |
`;

const EXPENSES_AGENTS_MD = `# Expenses

## Routing

| Task        | Go to    | Read           | Skills                  |
| ----------- | -------- | -------------- | ----------------------- |
| Tag vendors | vendors/ | vendors/CTX.md | tag-vendor,approve-receipt |
`;

const RECRUITING_AGENTS_MD = `# Recruiting

## Routing

| Task              | Go to      | Read | Skills           |
| ----------------- | ---------- | ---- | ---------------- |
| Score candidates  | scoring/   |      | score-candidate  |
`;

function pushSelect(rows: unknown[]) {
  dbState.selectQueue.push(rows);
}

beforeEach(() => {
  resetDbState();
  composeListMock.mockReset();
});

// ─── Tests ───────────────────────────────────────────────────────────────────

describe("deriveAgentSkills — happy paths", () => {
  it("unions skills across root + sub-agent AGENTS.md and dedups by slug", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("CONTEXT.md", "ignored"),
      composedEntry("AGENTS.md", ROOT_AGENTS_MD),
      composedEntry("expenses/AGENTS.md", EXPENSES_AGENTS_MD),
      composedEntry("recruiting/AGENTS.md", RECRUITING_AGENTS_MD),
      composedEntry("expenses/CONTEXT.md", "ignored"),
    ]);
    // Existing: empty.
    pushSelect([]);
    // Agent tenant lookup.
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(true);
    expect(result.addedSlugs).toEqual([
      "approve-receipt",
      "score-candidate",
      "tag-vendor",
    ]);
    expect(result.removedSlugs).toEqual([]);
    expect(result.agentsMdPathsScanned).toEqual([
      "AGENTS.md",
      "expenses/AGENTS.md",
      "recruiting/AGENTS.md",
    ]);
    expect(dbState.transactionInvocations).toBe(1);
    expect(dbState.insertCalls).toHaveLength(1);
    expect(dbState.insertCalls[0].values).toEqual([
      {
        agent_id: AGENT_ID,
        tenant_id: TENANT,
        skill_id: "approve-receipt",
      },
      {
        agent_id: AGENT_ID,
        tenant_id: TENANT,
        skill_id: "score-candidate",
      },
      {
        agent_id: AGENT_ID,
        tenant_id: TENANT,
        skill_id: "tag-vendor",
      },
    ]);
    expect(dbState.deleteCalls).toHaveLength(0);
  });

  it("returns changed:false and skips the transaction when sets already match (the legacy-loop short-circuit)", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("AGENTS.md", ROOT_AGENTS_MD),
    ]);
    pushSelect([{ skill_id: "approve-receipt" }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(false);
    expect(result.addedSlugs).toEqual([]);
    expect(result.removedSlugs).toEqual([]);
    expect(dbState.transactionInvocations).toBe(0);
    expect(dbState.insertCalls).toHaveLength(0);
    expect(dbState.deleteCalls).toHaveLength(0);
  });

  it("preserves unchanged rows via onConflictDoNothing when adding new slugs alongside existing ones", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("AGENTS.md", ROOT_AGENTS_MD),
      composedEntry("recruiting/AGENTS.md", RECRUITING_AGENTS_MD),
    ]);
    pushSelect([{ skill_id: "approve-receipt" }]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(true);
    expect(result.addedSlugs).toEqual(["score-candidate"]);
    expect(result.removedSlugs).toEqual([]);
    expect(dbState.insertCalls).toHaveLength(1);
    expect(dbState.insertCalls[0].values).toEqual([
      {
        agent_id: AGENT_ID,
        tenant_id: TENANT,
        skill_id: "score-candidate",
      },
    ]);
    // Verify the conflict target is the composite (agent_id, skill_id)
    // unique index — not just "some target". A swap to one column or a
    // different combination would silently break metadata-preservation.
    const conflictOpts = dbState.insertCalls[0].conflictTarget as
      | { target?: { __col?: string }[] }
      | undefined;
    expect(conflictOpts).toBeDefined();
    expect(conflictOpts?.target).toBeDefined();
    const targetCols = (conflictOpts?.target ?? []).map((c) => c?.__col);
    expect(targetCols).toEqual([
      "agent_skills.agent_id",
      "agent_skills.skill_id",
    ]);
    expect(dbState.deleteCalls).toHaveLength(0);
  });
});

describe("deriveAgentSkills — removals", () => {
  it("deletes slugs that no longer appear in any composed AGENTS.md", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("AGENTS.md", ROOT_AGENTS_MD),
    ]);
    pushSelect([
      { skill_id: "approve-receipt" },
      { skill_id: "stale-slug" },
      { skill_id: "another-stale" },
    ]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(true);
    expect(result.addedSlugs).toEqual([]);
    expect(result.removedSlugs).toEqual(["another-stale", "stale-slug"]);
    expect(dbState.deleteCalls).toHaveLength(1);
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("zero AGENTS.md entries → empty derived set wipes all rows (per master plan U11 line 721)", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("CONTEXT.md", "no agents map here"),
    ]);
    pushSelect([{ skill_id: "approve-receipt" }, { skill_id: "tag-vendor" }]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(true);
    expect(result.addedSlugs).toEqual([]);
    expect(result.removedSlugs).toEqual(["approve-receipt", "tag-vendor"]);
    expect(dbState.deleteCalls).toHaveLength(1);
  });

  it("all routing-row Skills cells empty → derives empty set", async () => {
    composeListMock.mockResolvedValue([
      composedEntry(
        "AGENTS.md",
        `## Routing\n\n| Task | Go to | Read | Skills |\n| --- | --- | --- | --- |\n| Bare | bare/ | x | |\n`,
      ),
    ]);
    pushSelect([{ skill_id: "approve-receipt" }]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.removedSlugs).toEqual(["approve-receipt"]);
    expect(result.addedSlugs).toEqual([]);
  });
});

describe("deriveAgentSkills — error and edge paths", () => {
  it("re-throws parser errors with the failing path prefixed; no DB writes", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("AGENTS.md", ROOT_AGENTS_MD),
      composedEntry(
        "broken/AGENTS.md",
        `# broken

| Col | A |
| --- | --- |
| 1 | 2 |

| Col | B |
| --- | --- |
| 3 | 4 |
`,
      ),
    ]);

    await expect(
      deriveAgentSkills(ctx(), AGENT_ID, deriveOpts),
    ).rejects.toThrow(/AGENTS\.md parse failed at broken\/AGENTS\.md:/);
    expect(dbState.transactionInvocations).toBe(0);
    expect(dbState.insertCalls).toHaveLength(0);
  });

  it("reserved goTo (memory/) is skipped by the parser → its skills don't enter the derived set", async () => {
    composeListMock.mockResolvedValue([
      composedEntry(
        "AGENTS.md",
        `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| Real | expenses/ | x | approve-receipt |
| Bad  | memory/   | x | should-not-appear |
`,
      ),
    ]);
    pushSelect([]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.addedSlugs).toEqual(["approve-receipt"]);
    expect(result.warnings.length).toBeGreaterThan(0);
    expect(result.warnings.join("\n")).toMatch(/memory.*reserved/i);
  });

  it("treats different-cased slugs as distinct (negative-assertion: no implicit lowercasing)", async () => {
    composeListMock.mockResolvedValue([
      composedEntry(
        "AGENTS.md",
        `## Routing

| Task | Go to | Read | Skills |
| --- | --- | --- | --- |
| One | a/ | x | Approve-Receipt |
| Two | b/ | x | approve-receipt |
`,
      ),
    ]);
    pushSelect([]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.addedSlugs).toEqual(["Approve-Receipt", "approve-receipt"]);
  });

  it("throws when the agent doesn't exist in the database", async () => {
    // The default reader looks up the agent + tenant slugs in the DB
    // to construct the agent-prefix S3 path. When the agent row is
    // missing it throws — the test injects a reader that mimics that
    // failure so we don't have to spin a real S3 + DB context.
    const missingAgentReader = vi
      .fn()
      .mockRejectedValue(
        new Error("Agent missing-agent not found in tenant tenant-a"),
      );

    await expect(
      deriveAgentSkills(ctx(), "missing-agent", {
        readAgentsMdFiles: missingAgentReader,
      }),
    ).rejects.toThrow(/Agent missing-agent not found/);
    expect(dbState.transactionInvocations).toBe(0);
  });

  it("propagates a transaction failure (insert rejects) up to the caller without swallowing", async () => {
    composeListMock.mockResolvedValue([
      composedEntry("AGENTS.md", ROOT_AGENTS_MD),
    ]);
    // Existing rows empty so the derive enters the transaction path.
    pushSelect([]);
    pushSelect([{ tenant_id: TENANT }]);
    dbState.failNextInsert = new Error("simulated drizzle insert failure");

    await expect(
      deriveAgentSkills(ctx(), AGENT_ID, deriveOpts),
    ).rejects.toThrow(/simulated drizzle insert failure/);
    // The transaction was opened (callback fired) and the insert was
    // attempted, but the failure propagates — caller sees no false
    // `changed: true` return.
    expect(dbState.transactionInvocations).toBe(1);
    expect(dbState.insertCalls).toHaveLength(1);
  });
});
