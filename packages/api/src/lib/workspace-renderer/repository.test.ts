/**
 * DrizzleWorkspaceTupleRepository.listRoutableAgentProfiles — space-local
 * profile scoping + shadowing for the generated routing tree
 * (plan 2026-06-12-002 U7, extending U2's listing).
 *
 * The drizzle chain is mocked with a scriptable rows queue; staging order per
 * call: profiles select → assignments select.
 */

import { beforeEach, describe, expect, it, vi } from "vitest";

const { rowsQueue } = vi.hoisted(() => ({
  rowsQueue: [] as unknown[][],
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    select: () => ({
      from: () => ({
        where: () => Promise.resolve(rowsQueue.shift() ?? []),
        innerJoin: () => ({
          where: () => Promise.resolve(rowsQueue.shift() ?? []),
        }),
      }),
    }),
  }),
}));

import { DrizzleWorkspaceTupleRepository } from "./repository.js";
import type { ResolvedWorkspaceRenderTuple } from "./types.js";

const TENANT_ID = "tenant-1";
const SPACE_A = "space-aaaa";
const SPACE_B = "space-bbbb";

function tuple(spaceId: string): ResolvedWorkspaceRenderTuple {
  return {
    tenantId: TENANT_ID,
    spaceId,
  } as unknown as ResolvedWorkspaceRenderTuple;
}

function centralRow(overrides?: Record<string, unknown>) {
  return {
    id: "profile-central-research",
    slug: "research",
    name: "Research (central)",
    routingGuidance: "Central guidance.",
    sourceSpaceId: null,
    ...overrides,
  };
}

function spaceLocalRow(overrides?: Record<string, unknown>) {
  return {
    id: "profile-space-research",
    slug: "research",
    name: "Research (space B)",
    routingGuidance: "Space B guidance.",
    sourceSpaceId: SPACE_B,
    ...overrides,
  };
}

beforeEach(() => {
  rowsQueue.length = 0;
});

describe("listRoutableAgentProfiles space-local scoping (U7)", () => {
  it("includes a space-local profile only while its origin Space is active", async () => {
    const repo = new DrizzleWorkspaceTupleRepository();
    const local = spaceLocalRow({ slug: "deal-desk", id: "profile-deal" });
    const assignment = { profileId: "profile-deal", spaceId: SPACE_B };

    rowsQueue.push([local]);
    rowsQueue.push([assignment]);
    const activeEntries = await repo.listRoutableAgentProfiles(tuple(SPACE_B));
    expect(activeEntries).toEqual([
      expect.objectContaining({ id: "profile-deal", slug: "deal-desk" }),
    ]);

    rowsQueue.push([local]);
    rowsQueue.push([assignment]);
    const otherEntries = await repo.listRoutableAgentProfiles(tuple(SPACE_A));
    expect(otherEntries).toEqual([]);
  });

  it("shadows the central slug while the space-local profile's Space is active", async () => {
    const repo = new DrizzleWorkspaceTupleRepository();
    const rows = [centralRow(), spaceLocalRow()];
    const assignments = [
      { profileId: "profile-space-research", spaceId: SPACE_B },
    ];

    rowsQueue.push(rows);
    rowsQueue.push(assignments);
    const spaceBEntries = await repo.listRoutableAgentProfiles(tuple(SPACE_B));
    expect(spaceBEntries).toHaveLength(1);
    expect(spaceBEntries[0]).toMatchObject({
      id: "profile-space-research",
      slug: "research",
    });

    rowsQueue.push(rows);
    rowsQueue.push(assignments);
    const spaceAEntries = await repo.listRoutableAgentProfiles(tuple(SPACE_A));
    expect(spaceAEntries).toHaveLength(1);
    expect(spaceAEntries[0]).toMatchObject({
      id: "profile-central-research",
      slug: "research",
    });
  });

  it("keeps central global + assigned profile behavior unchanged (regression)", async () => {
    const repo = new DrizzleWorkspaceTupleRepository();
    const globalProfile = centralRow();
    const assignedProfile = centralRow({
      id: "profile-central-coding",
      slug: "coding",
      name: "Coding",
      routingGuidance: null,
    });
    const assignments = [
      { profileId: "profile-central-coding", spaceId: SPACE_B },
    ];

    rowsQueue.push([globalProfile, assignedProfile]);
    rowsQueue.push(assignments);
    const spaceBEntries = await repo.listRoutableAgentProfiles(tuple(SPACE_B));
    expect(spaceBEntries.map((entry) => entry.slug).sort()).toEqual([
      "coding",
      "research",
    ]);

    rowsQueue.push([globalProfile, assignedProfile]);
    rowsQueue.push(assignments);
    const spaceAEntries = await repo.listRoutableAgentProfiles(tuple(SPACE_A));
    expect(spaceAEntries.map((entry) => entry.slug)).toEqual(["research"]);
  });
});

describe("listSpaceParticipants slug derivation (THNK-10 fetchable Users/<slug>/ paths)", () => {
  it("returns workspace_folder_name as the slug when set, else the derived user slug", async () => {
    const repo = new DrizzleWorkspaceTupleRepository();
    rowsQueue.push([
      {
        id: "user-2",
        name: "Jane Doe",
        email: "jane@example.com",
        workspaceFolderName: "jane-folder",
      },
      {
        id: "user-3",
        name: "Sam Lee",
        email: "Sam.Lee@example.com",
        workspaceFolderName: null,
      },
    ]);

    const participants = await repo.listSpaceParticipants(tuple(SPACE_A));

    expect(participants).toEqual([
      { id: "user-2", name: "Jane Doe", slug: "jane-folder" },
      { id: "user-3", name: "Sam Lee", slug: "sam-lee" },
    ]);
  });

  it("derives the slug from the name when the email is absent", async () => {
    const repo = new DrizzleWorkspaceTupleRepository();
    rowsQueue.push([
      {
        id: "user-4",
        name: "Ada Lovelace",
        email: null,
        workspaceFolderName: null,
      },
    ]);

    const participants = await repo.listSpaceParticipants(tuple(SPACE_A));

    expect(participants).toEqual([
      { id: "user-4", name: "Ada Lovelace", slug: "ada-lovelace" },
    ]);
  });
});
