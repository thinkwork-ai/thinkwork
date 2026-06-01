import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({
  updateSets: [] as unknown[],
  updateReturning: [] as Array<unknown[]>,
  reconcileChangedFiles: vi.fn(),
}));

vi.mock("@thinkwork/database-pg", () => ({
  getDb: () => ({
    update: () => ({
      set: (value: unknown) => {
        mocks.updateSets.push(value);
        return {
          where: () => ({
            returning: async () => mocks.updateReturning.shift() ?? [],
          }),
        };
      },
    }),
  }),
}));

vi.mock("./reconcile.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./reconcile.js")>();
  return {
    ...actual,
    reconcileChangedFiles: mocks.reconcileChangedFiles,
  };
});

import {
  capturedSystemPromptFromFinalizePayload,
  diagnosticsFromFinalizePayload,
  diagnosticsWithWorkspaceReconcile,
  isHiddenDesktopDelegation,
  processFinalize,
  toFinalizeResponse,
} from "./process-finalize";

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "22222222-2222-2222-2222-222222222222";
const THREAD_ID = "33333333-3333-3333-3333-333333333333";
const TURN_ID = "44444444-4444-4444-4444-444444444444";

beforeEach(() => {
  mocks.updateSets = [];
  mocks.updateReturning = [
    [
      {
        id: TURN_ID,
        runtimeType: "pi",
        contextSnapshot: null,
      },
    ],
  ];
  mocks.reconcileChangedFiles.mockReset();
  mocks.reconcileChangedFiles.mockResolvedValue({
    status: "no_changes",
    files: [],
  });
});

describe("capturedSystemPromptFromFinalizePayload", () => {
  it("uses the top-level composed prompt from runtime finalize payloads", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: "Current date: Monday",
        response: {},
      }),
    ).toBe("Current date: Monday");
  });

  it("falls back to a nested response prompt for older callback shapes", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: null,
        response: { composed_system_prompt: "Runtime Tool Policy" },
      }),
    ).toBe("Runtime Tool Policy");
  });

  it("ignores blank prompt values", () => {
    expect(
      capturedSystemPromptFromFinalizePayload({
        composed_system_prompt: "   ",
        response: { composed_system_prompt: "" },
      }),
    ).toBeNull();
  });
});

describe("diagnosticsFromFinalizePayload", () => {
  it("prefers usage diagnostics because they are persisted on usage_json", () => {
    expect(
      diagnosticsFromFinalizePayload({
        usage: { diagnostics: { local_pi_timings_ms: { total_ms: 123 } } },
        response: { diagnostics: { local_pi_timings_ms: { total_ms: 999 } } },
      }),
    ).toEqual({ local_pi_timings_ms: { total_ms: 123 } });
  });

  it("falls back to response diagnostics for older runtime payloads", () => {
    expect(
      diagnosticsFromFinalizePayload({
        response: { diagnostics: { local_pi_timings_ms: { total_ms: 456 } } },
      }),
    ).toEqual({ local_pi_timings_ms: { total_ms: 456 } });
  });
});

describe("diagnosticsWithWorkspaceReconcile", () => {
  it("adds reconcile timing and file counts to workspace diagnostics", () => {
    expect(
      diagnosticsWithWorkspaceReconcile(
        {
          workspace_diagnostics: {
            workspace_sync_ms: 42,
            changed_files: 1,
          },
        },
        {
          status: "partial_success",
          files: [
            {
              path: "AGENTS.md",
              op: "modify",
              owner: "agent",
              status: "written",
              sourceKey: "tenants/acme/agents/marco/AGENTS.md",
              etag: '"new"',
            },
            {
              path: "Thread/PROGRESS.md",
              op: "modify",
              owner: "status",
              status: "rejected",
              code: "read_only_status_file",
              message: "generated",
            },
            {
              path: "User/memory/stale.md",
              op: "modify",
              owner: "user",
              status: "rejected",
              code: "base_etag_mismatch",
              message: "stale",
            },
          ],
        },
        17,
      ),
    ).toMatchObject({
      workspace_diagnostics: {
        workspace_sync_ms: 42,
        reconcile_writeback_ms: 17,
        reconcile_status: "partial_success",
        changed_files: 3,
        persisted_files: 1,
        rejected_files: 2,
        conflicted_files: 1,
      },
    });
  });
});

describe("isHiddenDesktopDelegation", () => {
  it("detects hidden managed delegation turn contexts", () => {
    expect(
      isHiddenDesktopDelegation({
        desktop_managed_delegation: {
          visibility: "hidden",
        },
      }),
    ).toBe(true);
    expect(
      isHiddenDesktopDelegation({
        desktop_managed_delegation: {
          visibility: "visible",
        },
      }),
    ).toBe(false);
  });
});

describe("processFinalize reconcile seam", () => {
  it("re-enters reconcile on retry when the U4 non-empty diff stub throws", async () => {
    mocks.updateReturning = [
      [
        {
          id: TURN_ID,
          runtimeType: "pi",
          contextSnapshot: null,
        },
      ],
      [
        {
          id: TURN_ID,
          runtimeType: "pi",
          contextSnapshot: null,
        },
      ],
    ];
    mocks.reconcileChangedFiles.mockRejectedValue(new Error("stub throws"));
    const payload = {
      thread_turn_id: TURN_ID,
      tenant_id: TENANT_ID,
      agent_id: AGENT_ID,
      thread_id: THREAD_ID,
      duration_ms: 1,
      status: "completed" as const,
      response: { content: "done" },
      changed_files: [
        { path: "docs/new.md", op: "create" as const, content: "# New\n" },
      ],
    };

    await expect(processFinalize(payload)).rejects.toThrow("stub throws");
    await expect(processFinalize(payload)).rejects.toThrow("stub throws");

    expect(mocks.reconcileChangedFiles).toHaveBeenCalledTimes(2);
    expect(mocks.updateSets[0]).not.toHaveProperty("finalized_at");
    expect(mocks.updateSets).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ context_snapshot: expect.anything() }),
      ]),
    );
  });
});

describe("toFinalizeResponse", () => {
  it("surfaces reconcile status on non-idempotent finalize responses", () => {
    expect(
      toFinalizeResponse({
        finalized: true,
        messageId: "msg-1",
        reconcile: {
          status: "complete",
          files: [
            {
              path: "memory/preferences.md",
              op: "modify",
              owner: "user",
              status: "written",
              sourceKey: "tenants/acme/users/eric/memory/preferences.md",
              etag: '"new"',
            },
          ],
        },
      }),
    ).toEqual({
      ok: true,
      idempotent: false,
      messageId: "msg-1",
      reconcile: {
        status: "complete",
        files: [
          {
            path: "memory/preferences.md",
            op: "modify",
            owner: "user",
            status: "written",
            sourceKey: "tenants/acme/users/eric/memory/preferences.md",
            etag: '"new"',
          },
        ],
      },
    });
  });
});
