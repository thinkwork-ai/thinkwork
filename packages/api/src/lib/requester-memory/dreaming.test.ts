import { describe, expect, it, vi } from "vitest";
import {
  compactMemoryMarkdown,
  runRequesterMemoryDreamForUser,
  runRequesterMemoryDreaming,
} from "./dreaming.js";

function changed(path: string, content: string) {
  return {
    path,
    key: `key/${path}`,
    beforeHash: null,
    afterHash: String(content.length),
    beforeBytes: 0,
    afterBytes: content.length,
    snapshotKey: null,
  };
}

describe("requester memory dreaming", () => {
  it("runs light/rem/deep phases and promotes stable requester memory", async () => {
    const writes: Array<{ path: string; content: string }> = [];
    const syncHindsight = vi
      .fn()
      .mockResolvedValue({ status: "success", files: [] });
    const result = await runRequesterMemoryDreamForUser(
      {
        runId: "dream-1",
        now: "2026-05-18T18:00:00.000Z",
        force: true,
      },
      { tenantId: "tenant-1", userId: "user-1" },
      {
        loadRecentMessages: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            threadId: "thread-1",
            role: "user",
            content: "For future, remember I prefer concise summaries.",
            senderType: "user",
            senderId: "user-1",
            metadata: null,
            createdAt: new Date("2026-05-18T17:00:00.000Z"),
          },
        ]),
        listFiles: vi.fn().mockResolvedValue([
          { path: "memory/MEMORY.md", key: "memory-key" },
          { path: "memory/candidates/2026-05-18.md", key: "candidate-key" },
        ]),
        readSourceFile: vi
          .fn()
          .mockImplementation((_target, path) =>
            path === "memory/candidates/2026-05-18.md"
              ? "- [preference] For future, remember I prefer concise summaries.\n"
              : "",
          ),
        readPublicFile: vi.fn().mockResolvedValue("# Memory\n"),
        writePublicFile: vi.fn().mockImplementation(async (input) => {
          writes.push({ path: input.path, content: input.content });
          return changed(input.path, input.content);
        }),
        writeInternalFile: vi.fn().mockResolvedValue({}),
        reflect: vi
          .fn()
          .mockResolvedValue(
            "The requester consistently prefers concise summaries.",
          ),
        syncHindsight,
      },
    );

    expect(result.status).toBe("changed");
    expect(result.phaseSummary?.deep).toMatchObject({ promoted: 1 });
    expect(writes.map((write) => write.path)).toEqual([
      "memory/dreaming/light/2026-05-18.md",
      "memory/dreaming/rem/2026-05-18.md",
      "memory/DREAMS.md",
      "memory/MEMORY.md",
      "memory/dreaming/deep/2026-05-18.md",
    ]);
    expect(
      writes.find((write) => write.path === "memory/MEMORY.md")?.content,
    ).toContain("I prefer concise summaries");
    expect(syncHindsight).toHaveBeenCalledWith(
      expect.objectContaining({
        tenantId: "tenant-1",
        userId: "user-1",
        threadId: "requester-memory-dreaming",
        changedFiles: expect.arrayContaining([
          expect.objectContaining({ path: "memory/DREAMS.md" }),
          expect.objectContaining({ path: "memory/MEMORY.md" }),
        ]),
      }),
    );
  });

  it("skips users who are still active unless forced", async () => {
    const result = await runRequesterMemoryDreamForUser(
      {
        runId: "dream-1",
        now: "2026-05-18T18:00:00.000Z",
      },
      { tenantId: "tenant-1", userId: "user-1" },
      {
        loadRecentMessages: vi.fn().mockResolvedValue([
          {
            id: "msg-1",
            threadId: "thread-1",
            role: "user",
            content: "Remember this later.",
            senderType: "user",
            senderId: "user-1",
            metadata: null,
            createdAt: new Date("2026-05-18T17:55:00.000Z"),
          },
        ]),
      },
    );

    expect(result).toMatchObject({
      status: "skipped",
      reason: "user_active_within_15_minutes",
      changedFiles: [],
    });
  });

  it("sweeps all active targets when no explicit user is supplied", async () => {
    const result = await runRequesterMemoryDreaming(
      { runId: "dream-1", dryRun: true, force: true },
      {
        loadTargets: vi.fn().mockResolvedValue([
          { tenantId: "tenant-1", userId: "user-1" },
          { tenantId: "tenant-1", userId: "user-2" },
        ]),
        loadRecentMessages: vi.fn().mockResolvedValue([]),
        listFiles: vi.fn().mockResolvedValue([]),
        readPublicFile: vi.fn().mockResolvedValue(null),
        reflect: vi.fn().mockResolvedValue("No stable signals."),
      },
    );

    expect(result.ok).toBe(true);
    expect(result.budget.usersConsidered).toBe(2);
    expect(result.budget.usersProcessed).toBe(2);
    expect(result.budget.dryRun).toBe(true);
  });

  it("compacts duplicate durable memory bullets", () => {
    expect(
      compactMemoryMarkdown(
        "- [preference] Use concise summaries\n- [preference] Use concise summaries\n",
      ),
    ).toBe("- [preference] Use concise summaries\n");
  });
});
