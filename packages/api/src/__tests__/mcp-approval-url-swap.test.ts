/**
 * SI-5 URL-swap attack coverage — `applyMcpServerFieldUpdate` must revert
 * an approved row back to `pending` whenever `url` or `auth_config`
 * changes. Without this hook, an admin approves `url=A` and a subsequent
 * `updateMcpServer` could swap to `url=B` while keeping the approval,
 * silently pointing the runtime at an unapproved endpoint.
 */

import { describe, expect, it, vi } from "vitest";
import { applyMcpServerFieldUpdate } from "../lib/mcp-server-update.js";

function mkRow(over: Record<string, unknown> = {}) {
  return {
    id: "srv-1",
    url: "https://mcp.example/a",
    auth_config: { token: "tkn" },
    status: "approved",
    ...over,
  };
}

function mkDb(
  initial: Record<string, unknown>,
  captured: { set?: Record<string, unknown> },
) {
  const row = { ...initial };
  return {
    select: () => ({
      from: () => ({
        where: () => ({
          limit: () => Promise.resolve([row]),
        }),
      }),
    }),
    update: () => ({
      set: (payload: Record<string, unknown>) => ({
        where: () => {
          captured.set = payload;
          Object.assign(row, payload);
          return Promise.resolve();
        },
      }),
    }),
  };
}

describe("applyMcpServerFieldUpdate — SI-5 approved-row protection", () => {
  it("reverts approved→pending when url changes", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow(), captured);
    const result = await applyMcpServerFieldUpdate(db, "srv-1", {
      url: "https://mcp.example/b",
    });
    expect(result.revertedToPending).toBe(true);
    expect(captured.set).toMatchObject({
      status: "pending",
      url_hash: null,
      approved_by: null,
      approved_at: null,
      url: "https://mcp.example/b",
    });
  });

  it("reverts approved→pending when auth_config changes", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow(), captured);
    const result = await applyMcpServerFieldUpdate(db, "srv-1", {
      auth_config: { token: "swapped" },
    });
    expect(result.revertedToPending).toBe(true);
    expect(captured.set).toMatchObject({
      status: "pending",
      url_hash: null,
      approved_by: null,
      approved_at: null,
    });
  });

  it("does NOT revert when only non-sensitive fields change", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow(), captured);
    const result = await applyMcpServerFieldUpdate(db, "srv-1", {
      name: "renamed",
      enabled: false,
    });
    expect(result.revertedToPending).toBe(false);
    expect(captured.set?.status).toBeUndefined();
    expect(captured.set?.url_hash).toBeUndefined();
    expect(captured.set).toMatchObject({
      name: "renamed",
      enabled: false,
    });
  });

  it("does NOT revert when auth_config 'changes' are only key order", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow({ auth_config: { a: 1, b: 2 } }), captured);
    const result = await applyMcpServerFieldUpdate(db, "srv-1", {
      auth_config: { b: 2, a: 1 },
    });
    expect(result.revertedToPending).toBe(false);
  });

  it("does NOT revert on a pending row (nothing to clear)", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow({ status: "pending" }), captured);
    const result = await applyMcpServerFieldUpdate(db, "srv-1", {
      url: "https://mcp.example/b",
    });
    expect(result.revertedToPending).toBe(false);
    expect(captured.set?.status).toBeUndefined();
  });

  it("does NOT revert on a rejected row (terminal until re-approval)", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow({ status: "rejected" }), captured);
    const result = await applyMcpServerFieldUpdate(db, "srv-1", {
      url: "https://mcp.example/b",
    });
    expect(result.revertedToPending).toBe(false);
  });

  it("skipApprovalRevert option bypasses revert (documented system path)", async () => {
    const captured: { set?: Record<string, unknown> } = {};
    const db = mkDb(mkRow(), captured);
    const result = await applyMcpServerFieldUpdate(
      db,
      "srv-1",
      { auth_config: { token: "swapped" } },
      { skipApprovalRevert: true },
    );
    expect(result.revertedToPending).toBe(false);
    expect(captured.set?.status).toBeUndefined();
  });

  it("no-op result when server row does not exist", async () => {
    const db = {
      select: () => ({
        from: () => ({ where: () => ({ limit: () => Promise.resolve([]) }) }),
      }),
      update: vi.fn(),
    };
    const result = await applyMcpServerFieldUpdate(db, "missing", { url: "x" });
    expect(result.revertedToPending).toBe(false);
    expect(db.update).not.toHaveBeenCalled();
  });
});
