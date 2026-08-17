/**
 * Brain thread-flag client tests (THINK-781): ops-URL derivation, the
 * conversation serialization caps (200 messages / 8000 chars / 4000-char
 * note / 500-char identifiers), and the accepted/rejected/unreachable
 * response mapping the resolver builds its error surface on.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BRAIN_FLAG_MAX_CONVERSATION_MESSAGES,
  BRAIN_FLAG_MAX_MESSAGE_TEXT_CHARS,
  BRAIN_FLAG_MAX_NOTE_CHARS,
  brainSubmissionsUrlFrom,
  buildBrainFlagConversation,
  buildBrainFlagPayload,
  postBrainFlag,
} from "./flag-thread.js";

describe("brainSubmissionsUrlFrom", () => {
  it("rewrites /mcp and /mcp/twin suffixes to /submissions", () => {
    expect(brainSubmissionsUrlFrom("https://mcp.brain.thinkwork.ai/mcp")).toBe(
      "https://mcp.brain.thinkwork.ai/submissions",
    );
    expect(brainSubmissionsUrlFrom("https://mcp.brain.thinkwork.ai/mcp/twin")).toBe(
      "https://mcp.brain.thinkwork.ai/submissions",
    );
    expect(brainSubmissionsUrlFrom("https://mcp.brain.thinkwork.ai/mcp/")).toBe(
      "https://mcp.brain.thinkwork.ai/submissions",
    );
  });

  it("appends /submissions to a bare base URL", () => {
    expect(brainSubmissionsUrlFrom("https://brain.example.com")).toBe(
      "https://brain.example.com/submissions",
    );
  });
});

describe("buildBrainFlagConversation", () => {
  it("keeps user/assistant text (content column first, then text parts) and skips system/tool/empty rows", () => {
    const conversation = buildBrainFlagConversation([
      {
        id: "m1",
        role: "system",
        content: "system prompt",
        created_at: "2026-08-10T00:00:00Z",
      },
      {
        id: "m2",
        role: "USER",
        content: "pasted: SELECT * FROM credits",
        created_at: "2026-08-10T00:00:01Z",
      },
      {
        id: "m3",
        role: "assistant",
        content: null,
        parts: [
          { type: "text", text: "part one" },
          { type: "tool-call", text: "ignored-shape" },
          { type: "response", text: "part two" },
        ],
        created_at: new Date("2026-08-10T00:00:02Z"),
      },
      { id: "m4", role: "tool", content: "tool output" },
      { id: "m5", role: "assistant", content: "   " },
    ]);
    expect(conversation).toEqual([
      {
        role: "user",
        at: "2026-08-10T00:00:01.000Z",
        text: "pasted: SELECT * FROM credits",
      },
      {
        role: "assistant",
        at: "2026-08-10T00:00:02.000Z",
        text: "part one\n\npart two",
      },
    ]);
  });

  it("omits `at` when the timestamp is missing or unparsable", () => {
    const conversation = buildBrainFlagConversation([
      { id: "m1", role: "user", content: "hello", created_at: null },
    ]);
    expect(conversation).toEqual([{ role: "user", text: "hello" }]);
  });

  it("truncates message text to the per-message cap", () => {
    const conversation = buildBrainFlagConversation([
      {
        id: "m1",
        role: "user",
        content: "x".repeat(BRAIN_FLAG_MAX_MESSAGE_TEXT_CHARS + 100),
      },
    ]);
    expect(conversation[0].text).toHaveLength(
      BRAIN_FLAG_MAX_MESSAGE_TEXT_CHARS,
    );
  });

  it("drops the oldest messages beyond the 200-message cap", () => {
    const rows = Array.from({ length: 205 }, (_, i) => ({
      id: `m${i}`,
      role: "user",
      content: `message ${i}`,
    }));
    const conversation = buildBrainFlagConversation(rows);
    expect(conversation).toHaveLength(BRAIN_FLAG_MAX_CONVERSATION_MESSAGES);
    expect(conversation[0].text).toBe("message 5");
    expect(conversation.at(-1)?.text).toBe("message 204");
  });
});

describe("buildBrainFlagPayload", () => {
  it("builds the contract shape, omitting absent optional fields", () => {
    const payload = buildBrainFlagPayload({
      threadId: "thread-1",
      threadUrl: null,
      flaggedBy: null,
      note: "  the credit conclusion is wrong  ",
      messages: [{ id: "m1", role: "user", content: "q" }],
    });
    expect(payload).toEqual({
      source: "thinkwork-agent",
      thread_id: "thread-1",
      note: "the credit conclusion is wrong",
      conversation: [{ role: "user", text: "q" }],
    });
    expect(payload).not.toHaveProperty("thread_url");
    expect(payload).not.toHaveProperty("flagged_by");
  });

  it("truncates the note and identifier fields to the Brain's caps", () => {
    const payload = buildBrainFlagPayload({
      threadId: "t".repeat(600),
      threadUrl: `https://acct.thinkwork.ai/threads/${"u".repeat(600)}`,
      flaggedBy: `${"v".repeat(600)}@example.com`,
      note: "n".repeat(BRAIN_FLAG_MAX_NOTE_CHARS + 50),
      messages: [],
    });
    expect(payload.note).toHaveLength(BRAIN_FLAG_MAX_NOTE_CHARS);
    expect(payload.thread_id).toHaveLength(500);
    expect(payload.thread_url).toHaveLength(500);
    expect(payload.flagged_by).toHaveLength(500);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

const payload = buildBrainFlagPayload({
  threadId: "thread-1",
  threadUrl: null,
  flaggedBy: "user@example.com",
  note: "looks wrong",
  messages: [],
});

describe("postBrainFlag", () => {
  it("maps a 202 with both ids to accepted", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(202, { submission_id: "sub-1", task_id: "task-1" }),
      );
    const result = await postBrainFlag({
      submissionsUrl: "https://brain.example.com/submissions",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      kind: "accepted",
      flagId: "sub-1",
      taskId: "task-1",
      note: null,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://brain.example.com/submissions");
    expect(init.headers.authorization).toBe("Bearer tok");
    // The submission envelope: the flag body rides unchanged as payload,
    // and the flagger travels as the envelope's submitted_by.
    const body = JSON.parse(init.body);
    expect(body.kind).toBe("flag");
    expect(body.payload.source).toBe("thinkwork-agent");
    expect(body.payload.note).toBe("looks wrong");
    expect(body.submitted_by).toBe("user@example.com");
  });

  it("treats an accepted-but-not-dispatched response (note, no task_id) as success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(202, { submission_id: "sub-1", note: "queued for later" }),
      );
    const result = await postBrainFlag({
      submissionsUrl: "https://brain.example.com/submissions",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      kind: "accepted",
      flagId: "sub-1",
      taskId: null,
      note: "queued for later",
    });
  });

  it("maps 4xx to rejected with the server's validation message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: "note is required" }));
    const result = await postBrainFlag({
      submissionsUrl: "https://brain.example.com/submissions",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      kind: "rejected",
      status: 400,
      message: "note is required",
    });
  });

  it("maps 5xx and network errors to unreachable (retryable)", async () => {
    const serverError = await postBrainFlag({
      submissionsUrl: "https://brain.example.com/submissions",
      token: "tok",
      payload,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(503, {})),
    });
    expect(serverError.kind).toBe("unreachable");

    const networkError = await postBrainFlag({
      submissionsUrl: "https://brain.example.com/submissions",
      token: "tok",
      payload,
      fetchImpl: vi.fn().mockRejectedValue(new Error("ECONNREFUSED")),
    });
    expect(networkError).toEqual({
      kind: "unreachable",
      message: "ECONNREFUSED",
    });
  });

  it("treats a 2xx without a submission_id as unreachable rather than success", async () => {
    const result = await postBrainFlag({
      submissionsUrl: "https://brain.example.com/submissions",
      token: "tok",
      payload,
      fetchImpl: vi.fn().mockResolvedValue(jsonResponse(202, {})),
    });
    expect(result.kind).toBe("unreachable");
  });
});
