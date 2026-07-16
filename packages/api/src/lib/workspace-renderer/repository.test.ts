/**
 * DrizzleWorkspaceTupleRepository listing behavior. (The retired
 * listRoutableAgentProfiles moved to the compiled capabilities manifest
 * in subagent-folders U11 — routing entries derive from agents/<slug>/
 * folder files inside compose-tuple.)
 *
 * The drizzle chain is mocked with a scriptable rows queue.
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

function tuple(spaceId: string): ResolvedWorkspaceRenderTuple {
  return {
    tenantId: TENANT_ID,
    spaceId,
  } as unknown as ResolvedWorkspaceRenderTuple;
}

beforeEach(() => {
  rowsQueue.length = 0;
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
