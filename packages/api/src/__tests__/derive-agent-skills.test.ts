/**
 * Tests for derive-agent-skills.
 *
 * Workspace skill folders are the activation source:
 * Any workspace path ending in `skills/<slug>/SKILL.md` produces one
 * `agent_skills` row.
 * AGENTS.md references are documentation only.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { readWorkspaceMock, dbState, resetDbState } = vi.hoisted(() => {
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
    readWorkspaceMock: vi.fn(),
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

vi.mock("../graphql/utils.js", () => {
  const tableCol = (label: string) => ({ __col: label });

  const selectChain = () => ({
    from: () => ({
      where: () =>
        Promise.resolve((dbState.selectQueue.shift() ?? []) as unknown[]),
    }),
  });

  const insertChain = () => ({
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

  const deleteChain = () => ({
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

import { deriveAgentSkills } from "../lib/derive-agent-skills.js";

const TENANT = "tenant-a";
const AGENT_ID = "agent-marco";
const deriveOpts = { readAgentsMdFiles: readWorkspaceMock };

function ctx() {
  return { tenantId: TENANT };
}

function workspaceEntry(path: string) {
  return { path, content: "" };
}

function pushSelect(rows: unknown[]) {
  dbState.selectQueue.push(rows);
}

beforeEach(() => {
  resetDbState();
  readWorkspaceMock.mockReset();
});

describe("deriveAgentSkills — workspace skill folders", () => {
  it("derives rows from root and sub-agent workspace skill markers", async () => {
    readWorkspaceMock.mockResolvedValue([
      workspaceEntry("AGENTS.md"),
      workspaceEntry("skills/approve-receipt/SKILL.md"),
      workspaceEntry("sales/skills/tag-vendor/SKILL.md"),
      workspaceEntry("skills/empty/README.md"),
    ]);
    pushSelect([]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(true);
    expect(result.addedSlugs).toEqual(["approve-receipt", "tag-vendor"]);
    expect(result.removedSlugs).toEqual([]);
    expect(result.agentsMdPathsScanned).toEqual([
      "sales/skills/tag-vendor/SKILL.md",
      "skills/approve-receipt/SKILL.md",
    ]);
    expect(dbState.transactionInvocations).toBe(1);
    expect(dbState.insertCalls[0].values).toEqual([
      {
        agent_id: AGENT_ID,
        tenant_id: TENANT,
        skill_id: "approve-receipt",
      },
      {
        agent_id: AGENT_ID,
        tenant_id: TENANT,
        skill_id: "tag-vendor",
      },
    ]);
  });

  it("ignores AGENTS.md-only skill references", async () => {
    readWorkspaceMock.mockResolvedValue([
      workspaceEntry("AGENTS.md"),
      workspaceEntry("sales/AGENTS.md"),
    ]);
    pushSelect([{ skill_id: "orphaned-route-skill" }]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.addedSlugs).toEqual([]);
    expect(result.removedSlugs).toEqual(["orphaned-route-skill"]);
    expect(dbState.deleteCalls).toHaveLength(1);
  });

  it("returns changed:false and skips the transaction when sets already match", async () => {
    readWorkspaceMock.mockResolvedValue([
      workspaceEntry("skills/approve-receipt/SKILL.md"),
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

  it("deletes rows when a skill marker is removed", async () => {
    readWorkspaceMock.mockResolvedValue([]);
    pushSelect([{ skill_id: "approve-receipt" }, { skill_id: "tag-vendor" }]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.changed).toBe(true);
    expect(result.addedSlugs).toEqual([]);
    expect(result.removedSlugs).toEqual(["approve-receipt", "tag-vendor"]);
    expect(dbState.deleteCalls).toHaveLength(1);
  });

  it("preserves existing metadata via onConflictDoNothing when adding slugs", async () => {
    readWorkspaceMock.mockResolvedValue([
      workspaceEntry("skills/approve-receipt/SKILL.md"),
      workspaceEntry("skills/score-candidate/SKILL.md"),
    ]);
    pushSelect([{ skill_id: "approve-receipt" }]);
    pushSelect([{ tenant_id: TENANT }]);

    const result = await deriveAgentSkills(ctx(), AGENT_ID, deriveOpts);

    expect(result.addedSlugs).toEqual(["score-candidate"]);
    const conflictOpts = dbState.insertCalls[0].conflictTarget as
      | { target?: { __col?: string }[] }
      | undefined;
    expect(conflictOpts?.target?.map((c) => c.__col)).toEqual([
      "agent_skills.agent_id",
      "agent_skills.skill_id",
    ]);
  });
});

describe("deriveAgentSkills — failures", () => {
  it("propagates workspace reader failures", async () => {
    readWorkspaceMock.mockRejectedValue(
      new Error("Agent missing-agent not found in tenant tenant-a"),
    );

    await expect(
      deriveAgentSkills(ctx(), "missing-agent", deriveOpts),
    ).rejects.toThrow(/Agent missing-agent not found/);
    expect(dbState.transactionInvocations).toBe(0);
  });

  it("propagates a transaction failure without returning changed:true", async () => {
    readWorkspaceMock.mockResolvedValue([
      workspaceEntry("skills/approve-receipt/SKILL.md"),
    ]);
    pushSelect([]);
    pushSelect([{ tenant_id: TENANT }]);
    dbState.failNextInsert = new Error("simulated drizzle insert failure");

    await expect(
      deriveAgentSkills(ctx(), AGENT_ID, deriveOpts),
    ).rejects.toThrow(/simulated drizzle insert failure/);
    expect(dbState.transactionInvocations).toBe(1);
    expect(dbState.insertCalls).toHaveLength(1);
  });
});
