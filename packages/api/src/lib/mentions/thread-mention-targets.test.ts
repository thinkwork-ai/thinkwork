import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadThreadMentionTargets } from "./thread-mention-targets.js";

const source = readFileSync(
  new URL("./thread-mention-targets.ts", import.meta.url),
  "utf8",
);

describe("thread mention targets", () => {
  it("loads existing participants plus Space members and active Space agents", () => {
    expect(source).toContain("from(threadParticipants)");
    expect(source).toContain("from(spaceMembers)");
    expect(source).toContain("from(spaceAgentAssignments)");
    expect(source).toContain('eq(spaceAgentAssignments.status, "active")');
  });

  it("returns no targets when the Thread is not found", async () => {
    const repository = {
      async loadThread() {
        return null;
      },
      async loadTargets() {
        throw new Error("loadTargets should not be called");
      },
    };

    await expect(
      loadThreadMentionTargets(
        { tenantId: "tenant-1", threadId: "missing-thread" },
        repository,
      ),
    ).resolves.toEqual([]);
  });
});
