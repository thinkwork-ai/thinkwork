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

  it("adds current-turn attachment content to the system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const prompt = await buildSystemPrompt(
      {
        ...context(),
        attachments: [
          {
            attachmentId: "attachment-1",
            name: "agentic-etl-architecture-v5.md",
            mimeType: "text/markdown",
            sizeBytes: 42,
            readable: true,
            contentText: "# Hybrid Agentic ETL\n\nReady for implementation.",
          },
        ],
      },
      root,
    );

    expect(prompt).toContain("Files attached to the current user turn:");
    expect(prompt).toContain("Do not say that no file is attached.");
    expect(prompt).toContain("agentic-etl-architecture-v5.md");
    expect(prompt).toContain("# Hybrid Agentic ETL");
  });

  it("adds extracted binary attachment content to the system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const prompt = await buildSystemPrompt(
      {
        ...context(),
        attachments: [
          {
            attachmentId: "attachment-1",
            name: "financials.xlsx",
            mimeType:
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
            sizeBytes: 4096,
            readable: true,
            extractionKind: "xlsx",
            contentText: "Sheet: Statement\nRow 2: A2=Revenue | B2=12345",
          },
          {
            attachmentId: "attachment-2",
            name: "board-statement.pdf",
            mimeType: "application/pdf",
            sizeBytes: 2048,
            readable: true,
            extractionKind: "pdf",
            contentText: "Board revenue was 12345",
          },
        ],
      },
      root,
    );

    expect(prompt).toContain("financials.xlsx");
    expect(prompt).toContain("Extracted XLSX content:");
    expect(prompt).toContain("B2=12345");
    expect(prompt).toContain("board-statement.pdf");
    expect(prompt).toContain("Extracted PDF content:");
    expect(prompt).toContain("Board revenue was 12345");
  });

  it("keeps unsupported binary attachments visible with a reason", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const prompt = await buildSystemPrompt(
      {
        ...context(),
        attachments: [
          {
            attachmentId: "attachment-1",
            name: "archive.zip",
            mimeType: "application/zip",
            sizeBytes: 1024,
            readable: false,
            reason: "unsupported_mime_type",
          },
        ],
      },
      root,
    );

    expect(prompt).toContain("archive.zip");
    expect(prompt).toContain(
      "Content is not available inline (unsupported_mime_type).",
    );
  });

  it("adds requester memory overlay to the system prompt", async () => {
    const root = await mkdtemp(join(tmpdir(), "tw-computer-"));
    const prompt = await buildSystemPrompt(
      {
        ...context(),
        requesterContext: {
          contextClass: "personal_connector_event",
          computerId: "computer-1",
          requester: { userId: "user-eric" },
          sourceSurface: "gmail",
          credentialSubject: {
            type: "user",
            userId: "user-eric",
            connectionId: "connection-1",
            provider: "google_workspace",
          },
          event: {
            provider: "gmail",
            eventType: "message.created",
            eventId: "event-1",
          },
          personalMemory: {
            status: {
              providerId: "memory",
              displayName: "Hindsight Memory",
              state: "ok",
              hitCount: 1,
            },
            hits: [
              {
                id: "memory-1",
                title: "Launch brief preference",
                text: "Eric prefers concise launch briefs.",
                score: 0.9,
              },
            ],
          },
        },
      },
      root,
    );

    expect(prompt).toContain("Requester context overlay:");
    expect(prompt).toContain("Context class: personal_connector_event");
    expect(prompt).toContain("Credential subject: user:user-eric");
    expect(prompt).toContain("Connector event: gmail:message.created");
    expect(prompt).toContain(
      "Launch brief preference: Eric prefers concise launch briefs.",
    );
  });
});
