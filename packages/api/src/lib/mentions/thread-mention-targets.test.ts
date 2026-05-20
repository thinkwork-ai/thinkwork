import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { loadThreadMentionTargets } from "./thread-mention-targets.js";

const source = readFileSync(
  new URL("./thread-mention-targets.ts", import.meta.url),
  "utf8",
);

describe("thread mention targets", () => {
  it("loads existing participants, Space targets, tenant users, and active tenant agents", () => {
    expect(source).toContain("from(threadParticipants)");
    expect(source).toContain("from(spaceMembers)");
    expect(source).toContain("from(spaceAgentAssignments)");
    expect(source).toContain('eq(spaceAgentAssignments.status, "active")');
    expect(source).toContain("from(tenantMembers)");
    expect(source).toContain('eq(tenantMembers.status, "active")');
    expect(source).toContain("from(agents)");
    expect(source).toContain('ne(agents.status, "archived")');
  });

  it("uses agent names, not slugs, as the mention display and alias", () => {
    expect(source).toContain("displayName: row.agentName");
    expect(source).toContain("aliases: [row.agentName].filter(isString)");
    expect(source).not.toContain(
      "aliases: [row.agentName, row.agentSlug].filter(isString)",
    );
    expect(source).not.toContain("row.agentName ?? row.agentSlug");
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
