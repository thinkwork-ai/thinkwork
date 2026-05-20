import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./createThread.mutation.ts", import.meta.url),
  "utf8",
);

describe("createThread opening message mention routing", () => {
  it("persists opening message mentions and participants after the thread exists", () => {
    expect(source).toContain("persistOpeningMessageMentions");
    expect(source).toContain("loadThreadMentionTargets");
    expect(source).toContain("parseMessageMentions");
    expect(source).toContain("insert(messageMentions)");
    expect(source).toContain("insertMentionParticipants");
  });

  it("routes opening messages to mentioned or default agents without double dispatch", () => {
    expect(source).toContain("hasOpeningAgentMentions");
    expect(source).toContain("dispatchAgentMentions");
    expect(source).toContain("dispatchDefaultAgentTurn");
    expect(source).toContain("parsedOpeningMentions.length === 0");
    expect(source).toContain(
      "row.computer_id && parsedOpeningMentions.length === 0",
    );
  });

  it("marks the thread creator read for the opening message", () => {
    expect(source).toContain("openingMessageCreatedAt");
    expect(source).toContain("created_at: openingMessageCreatedAt");
    expect(source).toContain("updated_at: openingMessageCreatedAt");
    expect(source).toContain("last_read_at: openingMessageCreatedAt");
  });
});
