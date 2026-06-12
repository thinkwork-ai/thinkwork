/**
 * wiki-bootstrap-import handler — graph-mode contract note
 * (plan 2026-06-09-004 U14).
 *
 * In graph mode the "retain → terminal compile produces pages" contract
 * breaks: pages materialize only after consolidation → observations ingest
 * → graph materialization. The handler must SAY so in its operator-facing
 * result rather than faking synchronous pages.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

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
  delete process.env.WIKI_SOURCE;
  mockRunJournalImport.mockResolvedValue({
    recordsIngested: 10,
    recordsSkipped: 1,
    errors: 0,
    compileJobId: "job-1",
  });
});

afterEach(() => {
  delete process.env.WIKI_SOURCE;
});

describe("wiki-bootstrap-import graph-mode note", () => {
  it("states the materialization contract when WIKI_SOURCE=graph", async () => {
    process.env.WIKI_SOURCE = "graph";
    const out = await handler(EVENT);
    expect(out.ok).toBe(true);
    expect(out.note).toMatch(/WIKI_SOURCE=graph/);
    expect(out.note).toMatch(/observations ingest/i);
    expect(out.note).toMatch(/NOT produce wiki pages/);
  });

  it("emits no note on the planner path (contract unchanged)", async () => {
    const out = await handler(EVENT);
    expect(out.ok).toBe(true);
    expect(out.note).toBeUndefined();
  });

  it("still fails loudly on missing event fields", async () => {
    const out = await handler({});
    expect(out.ok).toBe(false);
    expect(out.error).toMatch(/missing/);
    expect(mockRunJournalImport).not.toHaveBeenCalled();
  });
});
