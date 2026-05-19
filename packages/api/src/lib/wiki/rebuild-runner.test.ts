import { beforeEach, describe, expect, it, vi } from "vitest";

const countWikiScope = vi.fn();

vi.mock("./repository.js", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./repository.js")>();
  return {
    ...actual,
    countWikiScope,
  };
});

const baseWikiCounts = {
  pages: 3,
  sections: 4,
  links: 5,
  aliases: 2,
  unresolved_mentions: 1,
  compile_jobs: 6,
  has_cursor: true,
  pages_with_parent: 0,
  sections_promoted: 0,
  sections_promotion_candidate: 0,
};

describe("scoped wiki rebuild reset", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("reports dry-run impact without mutating", async () => {
    const { inspectScopedWikiRebuildImpact, resetScopedWikiRebuild } =
      await import("./rebuild-runner.js");
    countWikiScope.mockResolvedValue(baseWikiCounts);
    const db = makeFakeDb([
      { rows: [{ n: 2 }] },
      {
        rows: [
          {
            pages: 7,
            sections: 8,
            links: 9,
            aliases: 10,
            section_sources: 11,
          },
        ],
      },
      { rows: [{ pending_jobs: 0, running_jobs: 0 }] },
      { rows: [{ n: 2 }] },
      {
        rows: [
          {
            pages: 7,
            sections: 8,
            links: 9,
            aliases: 10,
            section_sources: 11,
          },
        ],
      },
      { rows: [{ pending_jobs: 0, running_jobs: 0 }] },
    ]);

    const impact = await inspectScopedWikiRebuildImpact({
      tenantId: "tenant-1",
      ownerId: "user-1",
      includeBrain: true,
      db: db as any,
    });
    expect(impact.wiki.active_pages).toBe(2);
    expect(impact.brain?.pages).toBe(7);

    const dryRun = await resetScopedWikiRebuild({
      tenantId: "tenant-1",
      ownerId: "user-1",
      includeBrain: true,
      dryRun: true,
      db: db as any,
    });
    expect(dryRun.dryRun).toBe(true);
    expect(dryRun.cursorCleared).toBe(false);
    expect(db.transaction).not.toHaveBeenCalled();
  }, 15_000);

  it("refuses destructive reset when compile jobs are still open", async () => {
    const { resetScopedWikiRebuild, WikiRebuildInProgressError } = await import(
      "./rebuild-runner.js"
    );
    countWikiScope.mockResolvedValue(baseWikiCounts);
    const db = makeFakeDb([
      { rows: [{ n: 2 }] },
      { rows: [{ pending_jobs: 1, running_jobs: 1 }] },
    ]);

    await expect(
      resetScopedWikiRebuild({
        tenantId: "tenant-1",
        ownerId: "user-1",
        db: db as any,
      }),
    ).rejects.toBeInstanceOf(WikiRebuildInProgressError);
    expect(db.transaction).not.toHaveBeenCalled();
  }, 15_000);

  it("archives wiki output, clears cursor, deletes Brain rows, and reports after counts", async () => {
    const { resetScopedWikiRebuild } = await import("./rebuild-runner.js");
    countWikiScope.mockResolvedValueOnce(baseWikiCounts).mockResolvedValueOnce({
      ...baseWikiCounts,
      pages: 3,
      has_cursor: false,
    });
    const db = makeFakeDb([
      { rows: [{ n: 2 }] },
      {
        rows: [
          { pages: 7, sections: 8, links: 9, aliases: 10, section_sources: 11 },
        ],
      },
      { rows: [{ pending_jobs: 0, running_jobs: 0 }] },
      { rows: [] },
      { rows: [{ id: "brain-page-1" }, { id: "brain-page-2" }] },
      { rows: [{ n: 0 }] },
      {
        rows: [
          { pages: 0, sections: 0, links: 0, aliases: 0, section_sources: 0 },
        ],
      },
      { rows: [{ pending_jobs: 0, running_jobs: 0 }] },
    ]);

    const result = await resetScopedWikiRebuild({
      tenantId: "tenant-1",
      ownerId: "user-1",
      includeBrain: true,
      db: db as any,
    });

    expect(result.pagesArchived).toBe(2);
    expect(result.unresolvedMentionsDeleted).toBe(1);
    expect(result.brainPagesDeleted).toBe(2);
    expect(result.after?.wiki.has_cursor).toBe(false);
    expect(db.transaction).toHaveBeenCalledTimes(1);
  }, 15_000);
});

function makeFakeDb(
  executeResults: Array<{ rows: Array<Record<string, unknown>> }>,
) {
  const execute = vi.fn(async () => {
    const next = executeResults.shift();
    if (!next) throw new Error("Unexpected execute call");
    return next;
  });
  let deleteCalls = 0;
  const tx = {
    execute,
    delete: vi.fn(() => {
      deleteCalls += 1;
      return deleteChain(deleteCalls);
    }),
    update: vi.fn(() => updateChain()),
  };
  const db = {
    ...tx,
    transaction: vi.fn(async (fn: (inner: typeof tx) => Promise<void>) =>
      fn(tx),
    ),
  };
  return db;
}

function deleteChain(callIndex: number) {
  return {
    where: vi.fn(() => ({
      returning: vi.fn(async () =>
        callIndex === 1 ? [{ id: "mention-1" }] : [],
      ),
    })),
  };
}

function updateChain() {
  return {
    set: vi.fn(() => ({
      where: vi.fn(() => ({
        returning: vi.fn(async () => [{ id: "page-1" }, { id: "page-2" }]),
      })),
    })),
  };
}
