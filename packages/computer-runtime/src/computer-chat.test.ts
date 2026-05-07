import { mkdtemp, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { describe, expect, it } from "vitest";
import { buildSystemPrompt } from "./computer-chat.js";
import type { ThreadTurnContext } from "./api-client.js";

function context(): ThreadTurnContext {
  return {
    taskId: "task-1",
    source: "chat_message",
    computer: {
      id: "computer-1",
      name: "Marco",
      slug: "marco",
      workspaceRoot: "/workspace",
    },
    thread: { id: "thread-1", title: "Question" },
    message: { id: "message-1", content: "What is my name?" },
    messagesHistory: [
      { id: "message-1", role: "user", content: "What is my name?" },
    ],
    model: "model-1",
    systemPrompt: "You are Marco.",
  };
}

describe("Computer chat system prompt", () => {
  it("appends local workspace files to the API system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    await writeFile(join(root, "IDENTITY.md"), "Name: Marco\n", {
      encoding: "utf8",
    });
    await writeFile(join(root, "USER.md"), "Name: Eric\n", {
      encoding: "utf8",
    });

    const prompt = await buildSystemPrompt(context(), root);

    expect(prompt).toContain("You are Marco.");
    expect(prompt).toContain("# IDENTITY.md");
    expect(prompt).toContain("Name: Marco");
    expect(prompt).toContain("# USER.md");
    expect(prompt).toContain("Name: Eric");
  });
});
