/**
 * ensureMemoryBlueprintVersion tests (THINK-193 U3).
 *
 * Fake-db style like workflow-interpreter-db.test.ts: the adapter runs
 * against an in-memory fake; assertions inspect captured inserts/updates.
 */
import { beforeEach, describe, expect, it, vi } from "vitest";

import {
  MEMORY_BLUEPRINT_VERSION,
  PERSONAL_MEMORY_BLUEPRINT_KEY,
  SHARED_MEMORY_BLUEPRINT_KEY,
} from "@thinkwork/agent-loops-core";
import { ensureMemoryBlueprintVersion } from "../src/workflow-blueprint-db";

type Rows = Record<string, unknown>[];

const selectQueue: Rows[] = [];
const insertRows = vi.fn<() => Rows>();
const insertValues = vi.fn();
const updateValues = vi.fn();
let insertThrows: Error | null = null;

function fakeDb() {
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve(selectQueue.shift() ?? []),
        }),
      }),
    }),
    insert: () => ({
      values: (value: Record<string, unknown>) => {
        insertValues(value);
        return {
          returning: () => {
            if (insertThrows) return Promise.reject(insertThrows);
            return Promise.resolve(insertRows() ?? []);
          },
        };
      },
    }),
    update: () => ({
      set: (value: Record<string, unknown>) => {
        updateValues(value);
        return { where: () => Promise.resolve([]) };
      },
    }),
  };
}

const TENANT = "t1";
const WORKFLOW = "wf-1";
const PROCESSOR = "proc-1";

function processorRow(mode = "personal", status = "active") {
  return { id: PROCESSOR, mode, status };
}

function activeVersionRow(overrides: Record<string, unknown> = {}) {
  return {
    id: "v1",
    version_number: 3,
    source_metadata: {
      blueprintKey: PERSONAL_MEMORY_BLUEPRINT_KEY,
      blueprintVersion: MEMORY_BLUEPRINT_VERSION,
      processorConfigId: PROCESSOR,
    },
    ...overrides,
  };
}

beforeEach(() => {
  selectQueue.length = 0;
  insertRows.mockReset();
  insertValues.mockReset();
  updateValues.mockReset();
  insertRows.mockReturnValue([{ id: "v-new" }]);
  insertThrows = null;
});

describe("ensureMemoryBlueprintVersion", () => {
  it("is a no-op for workflows no memory processor manages", async () => {
    selectQueue.push([]); // no processor
    const result = await ensureMemoryBlueprintVersion(fakeDb() as never, {
      tenantId: TENANT,
      workflowId: WORKFLOW,
    });
    expect(result).toEqual({
      managed: false,
      published: false,
      versionId: null,
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("returns the current version untouched when metadata already matches", async () => {
    selectQueue.push([processorRow()], [activeVersionRow()]);
    const result = await ensureMemoryBlueprintVersion(fakeDb() as never, {
      tenantId: TENANT,
      workflowId: WORKFLOW,
    });
    expect(result).toEqual({
      managed: true,
      published: false,
      versionId: "v1",
    });
    expect(insertValues).not.toHaveBeenCalled();
  });

  it("supersedes and publishes when the blueprint version moved", async () => {
    selectQueue.push(
      [processorRow()],
      [
        activeVersionRow({
          source_metadata: {
            blueprintKey: PERSONAL_MEMORY_BLUEPRINT_KEY,
            blueprintVersion: MEMORY_BLUEPRINT_VERSION - 1,
            processorConfigId: PROCESSOR,
          },
        }),
      ],
    );
    const result = await ensureMemoryBlueprintVersion(fakeDb() as never, {
      tenantId: TENANT,
      workflowId: WORKFLOW,
    });
    expect(result).toEqual({
      managed: true,
      published: true,
      versionId: "v-new",
    });
    // Old version superseded, workflow repointed.
    expect(updateValues).toHaveBeenCalledWith({ version_status: "superseded" });
    expect(updateValues).toHaveBeenCalledWith(
      expect.objectContaining({
        current_version_id: "v-new",
        current_version_number: 4,
      }),
    );
    const inserted = insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      workflow_id: WORKFLOW,
      version_number: 4,
      version_status: "active",
      source_metadata: {
        blueprintKey: PERSONAL_MEMORY_BLUEPRINT_KEY,
        blueprintVersion: MEMORY_BLUEPRINT_VERSION,
        processorConfigId: PROCESSOR,
      },
    });
    const snapshot = inserted.definition_snapshot as {
      steps: Array<{ kind: string; stage?: string }>;
    };
    expect(snapshot.steps.some((step) => step.stage === "graph")).toBe(false); // personal omits graph/wiki
  });

  it("publishes the SHARED blueprint (with graph/wiki) for shared processors", async () => {
    selectQueue.push([processorRow("shared")], []); // no active version yet
    await ensureMemoryBlueprintVersion(fakeDb() as never, {
      tenantId: TENANT,
      workflowId: WORKFLOW,
    });
    const inserted = insertValues.mock.calls[0]![0] as Record<string, unknown>;
    expect(inserted).toMatchObject({
      version_number: 1,
      source_metadata: expect.objectContaining({
        blueprintKey: SHARED_MEMORY_BLUEPRINT_KEY,
      }),
    });
    const snapshot = inserted.definition_snapshot as {
      steps: Array<{ kind: string; stage?: string }>;
    };
    expect(snapshot.steps.some((step) => step.stage === "wiki")).toBe(true);
  });

  it("ignores disabled processors", async () => {
    selectQueue.push([processorRow("personal", "disabled")]);
    const result = await ensureMemoryBlueprintVersion(fakeDb() as never, {
      tenantId: TENANT,
      workflowId: WORKFLOW,
    });
    expect(result.managed).toBe(false);
  });

  it("adopts the concurrent winner's version on a unique-violation race", async () => {
    insertThrows = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    selectQueue.push(
      [processorRow()],
      [], // no active version at first read
      [activeVersionRow({ id: "v-winner", version_number: 1 })], // re-read
    );
    const result = await ensureMemoryBlueprintVersion(fakeDb() as never, {
      tenantId: TENANT,
      workflowId: WORKFLOW,
    });
    expect(result).toEqual({
      managed: true,
      published: false,
      versionId: "v-winner",
    });
  });

  it("rethrows a race whose survivor does not carry the blueprint", async () => {
    insertThrows = Object.assign(new Error("duplicate key value"), {
      code: "23505",
    });
    selectQueue.push(
      [processorRow()],
      [],
      [activeVersionRow({ source_metadata: { blueprintKey: "other" } })],
    );
    await expect(
      ensureMemoryBlueprintVersion(fakeDb() as never, {
        tenantId: TENANT,
        workflowId: WORKFLOW,
      }),
    ).rejects.toThrow(/duplicate key/);
  });
});
