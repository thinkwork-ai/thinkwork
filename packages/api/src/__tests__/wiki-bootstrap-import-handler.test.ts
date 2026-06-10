/**
 * wiki-bootstrap-import handler — graph contract note
 * (plan 2026-06-09-004 U14/U11).
 *
 * The "retain → terminal compile produces pages" contract no longer holds:
 * pages materialize only after consolidation → observations ingest →
 * graph materialization. The handler must SAY so in its operator-facing
 * result rather than faking synchronous pages.
 */

import { describe, it, expect, vi, beforeEach } from "vitest";

const { mockRunJournalImport } = vi.hoisted(() => ({
  mockRunJournalImport: vi.fn(),
}));

vi.mock("../lib/wiki/journal-import.js", () => ({
  runJournalImport: mockRunJournalImport,
}));

import { handler } from "../handlers/wiki-bootstrap-import.js";

const EVENT = {
  accountId: "acct-1",
  tenantId: "t1",
  userId: "u1",
};

beforeEach(() => {
  vi.clearAllMocks();
  mockRunJournalImport.mockResolvedValue({
    recordsIngested: 10,
    recordsSkipped: 1,
    errors: 0,
    compileJobId: "job-1",
  });
});

describe("wiki-bootstrap-import graph contract note", () => {
  it("always states the materialization contract (graph-only since U11)", async () => {
    const out = await handler(EVENT);
    expect(out.ok).toBe(true);
    expect(out.note).toMatch(/observations ingest/i);
    expect(out.note).toMatch(/NOT produce wiki pages/);
  });

  it("still fails loudly on missing event fields", async () => {
    const out = await handler({});
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/missing/);
    expect(mockRunJournalImport).not.toHaveBeenCalled();
  });
});
