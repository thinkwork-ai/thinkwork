import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

const source = readFileSync(
  new URL("./createThread.mutation.ts", import.meta.url),
  "utf8",
);
const threadsGraphql = readFileSync(
  new URL(
    "../../../../../database-pg/graphql/types/threads.graphql",
    import.meta.url,
  ),
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
    expect(source).toContain("dispatchDefaultAgentChatTurn");
    expect(source).toContain("!hasOpeningAgentMentions");
    expect(source).toContain("requestedProfileSlug");
  });

  it("marks the thread creator read for the opening message", () => {
    expect(source).toContain("openingMessageCreatedAt");
    expect(source).toContain("created_at: openingMessageCreatedAt");
    expect(source).toContain("updated_at: openingMessageCreatedAt");
    expect(source).toContain("last_read_at: openingMessageCreatedAt");
  });

  it("binds new threads to the tenant platform agent by default", () => {
    expect(source).toContain("resolveDefaultThreadAgentId");
    expect(source).toContain("const threadAgentId =");
    expect(source).toContain("agent_id: threadAgentId ?? undefined");
  });

  it("can atomically seed a mobile Pi turn for opening mobile messages", () => {
    expect(source).toContain("mobileTurnClientId");
    expect(source).toContain("MOBILE_PI_INVOCATION_SOURCE");
    expect(source).toContain("checkpoint_0");
    expect(source).toContain("notifyThreadTurnUpdate");
  });

  it("validates and persists selected parent models for opening messages", () => {
    expect(threadsGraphql).toContain("modelId: String");
    expect(source).toContain("resolveRequestedModelId");
    expect(source).toContain("assertUserModelApproved");
    expect(source.indexOf("await assertUserModelApproved")).toBeLessThan(
      source.indexOf("db.transaction"),
    );
    expect(source).toContain("withRequestedModelMetadata");
    expect(source).toContain("requestedModelId,");
  });
});
