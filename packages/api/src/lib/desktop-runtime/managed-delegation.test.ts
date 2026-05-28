import { describe, expect, it, vi } from "vitest";
import {
  runManagedDelegation,
  type ManagedDelegationDeps,
} from "./managed-delegation.js";
import { hashDesktopFinalizeToken } from "./sidecar-credentials.js";

vi.mock("../db.js", () => ({ db: {} }));

const TENANT_ID = "11111111-1111-1111-1111-111111111111";
const AGENT_ID = "33333333-3333-3333-3333-333333333333";
const THREAD_ID = "44444444-4444-4444-4444-444444444444";
const PARENT_TURN_ID = "66666666-6666-6666-6666-666666666666";
const CHILD_TURN_ID = "77777777-7777-7777-7777-777777777777";
const TOKEN = "dps_secret";

function makeDeps(
  overrides: Partial<ManagedDelegationDeps> = {},
): ManagedDelegationDeps {
  let pollCount = 0;
  return {
    now: () => new Date("2026-05-28T12:00:00.000Z"),
    loadParentTurn: vi.fn(async () => ({
      id: PARENT_TURN_ID,
      tenantId: TENANT_ID,
      agentId: AGENT_ID,
      threadId: THREAD_ID,
      status: "running",
      contextSnapshot: {
        runtime_host: "desktop-local",
        desktop_runtime_session: {
          finalize_token_sha256: hashDesktopFinalizeToken(TOKEN),
          expires_at: "2026-05-28T13:00:00.000Z",
        },
      },
    })),
    dispatchManagedTurn: vi.fn(async () => ({
      threadTurnId: CHILD_TURN_ID,
    })),
    loadDelegatedTurnResult: vi.fn(async () => {
      pollCount++;
      return pollCount < 2
        ? { status: "running", resultJson: null, usageJson: null, error: null }
        : {
            status: "succeeded",
            resultJson: { response: "Managed worker result", runtime: "pi" },
            usageJson: { tool_invocations: [], tool_costs: [] },
            error: null,
          };
    }),
    sleep: vi.fn(async () => {}),
    ...overrides,
  };
}

describe("runManagedDelegation", () => {
  it("validates the parent sidecar token, dispatches a hidden worker, and returns its result", async () => {
    const deps = makeDeps();

    const result = await runManagedDelegation(
      {
        parentThreadTurnId: PARENT_TURN_ID,
        finalizeCallbackSecret: TOKEN,
        task: "Summarize hosted workspace files",
        requestedVisibility: "hidden",
        timeoutMs: 1_000,
      },
      deps,
    );

    expect(result).toMatchObject({
      ok: true,
      parentThreadTurnId: PARENT_TURN_ID,
      childThreadTurnId: CHILD_TURN_ID,
      requestedVisibility: "hidden",
      effectiveVisibility: "hidden",
      status: "completed",
      result: { content: "Managed worker result", runtime: "pi" },
    });
    expect(deps.dispatchManagedTurn).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: TENANT_ID,
        agentId: AGENT_ID,
        threadId: THREAD_ID,
        parentThreadTurnId: PARENT_TURN_ID,
      }),
    );
  });

  it("forces consequential hidden requests into visible delegation", async () => {
    const deps = makeDeps();

    const result = await runManagedDelegation(
      {
        parentThreadTurnId: PARENT_TURN_ID,
        finalizeCallbackSecret: TOKEN,
        task: "Deploy this to production",
        requestedVisibility: "hidden",
      },
      deps,
    );

    expect(result.effectiveVisibility).toBe("visible");
    expect(result.status).toBe("accepted");
    expect(deps.loadDelegatedTurnResult).not.toHaveBeenCalled();
  });

  it("caps hidden result polling below the Lambda timeout budget", async () => {
    let tick = 0;
    const start = Date.parse("2026-05-28T12:00:00.000Z");
    const deps = makeDeps({
      now: () => new Date(start + tick++ * 10_000),
      loadDelegatedTurnResult: vi.fn(async () => ({
        status: "running",
        resultJson: null,
        usageJson: null,
        error: null,
      })),
    });

    const result = await runManagedDelegation(
      {
        parentThreadTurnId: PARENT_TURN_ID,
        finalizeCallbackSecret: TOKEN,
        task: "Summarize hosted workspace files",
        requestedVisibility: "hidden",
        timeoutMs: 999_999,
      },
      deps,
    );

    expect(result.status).toBe("accepted");
    expect(deps.loadDelegatedTurnResult).toHaveBeenCalledTimes(3);
  });

  it("rejects invalid sidecar tokens before dispatch", async () => {
    const deps = makeDeps();

    await expect(
      runManagedDelegation(
        {
          parentThreadTurnId: PARENT_TURN_ID,
          finalizeCallbackSecret: "wrong",
          task: "Do hosted work",
          requestedVisibility: "hidden",
        },
        deps,
      ),
    ).rejects.toMatchObject({
      statusCode: 401,
      code: "INVALID_SIDECAR_TOKEN",
    });
    expect(deps.dispatchManagedTurn).not.toHaveBeenCalled();
  });
});
