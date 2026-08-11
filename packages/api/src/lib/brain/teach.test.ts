/**
 * Brain teaching client tests (THINK-784): URL derivation, payload
 * shaping (truncation, optional omission), and response mapping through
 * the shared ops-post semantics.
 */

import { describe, expect, it, vi } from "vitest";
import {
  BRAIN_TEACHING_MAX_IDENTIFIER_CHARS,
  BRAIN_TEACHING_MAX_TEXT_CHARS,
  brainTeachingsUrlFrom,
  buildBrainTeachingPayload,
  postBrainTeaching,
} from "./teach.js";

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("brainTeachingsUrlFrom", () => {
  it("derives /teachings from a bare ops-api origin", () => {
    expect(
      brainTeachingsUrlFrom(
        "https://opsapi.execute-api.us-east-1.amazonaws.com",
      ),
    ).toBe("https://opsapi.execute-api.us-east-1.amazonaws.com/teachings");
  });

  it("strips /mcp and /mcp/twin suffixes and trailing slashes", () => {
    expect(brainTeachingsUrlFrom("https://mcp.brain.thinkwork.ai/mcp")).toBe(
      "https://mcp.brain.thinkwork.ai/teachings",
    );
    expect(
      brainTeachingsUrlFrom("https://mcp.brain.thinkwork.ai/mcp/twin/"),
    ).toBe("https://mcp.brain.thinkwork.ai/teachings");
  });
});

describe("buildBrainTeachingPayload", () => {
  it("builds the minimal payload, omitting absent optionals", () => {
    expect(
      buildBrainTeachingPayload({
        taughtBy: " expert@mcpherson.com ",
        text: "  The Waco generator is the Beast.  ",
      }),
    ).toEqual({
      source: "thinkwork-agent",
      taught_by: "expert@mcpherson.com",
      text: "The Waco generator is the Beast.",
    });
  });

  it("carries domain and context_thread_url when present", () => {
    expect(
      buildBrainTeachingPayload({
        taughtBy: "expert@mcpherson.com",
        text: "teach",
        domain: "fuel-logistics",
        contextThreadUrl: "https://app.thinkwork.ai/threads/t1",
      }),
    ).toEqual({
      source: "thinkwork-agent",
      taught_by: "expert@mcpherson.com",
      domain: "fuel-logistics",
      text: "teach",
      context_thread_url: "https://app.thinkwork.ai/threads/t1",
    });
  });

  it("carries answers_question_id when answering an expert question", () => {
    expect(
      buildBrainTeachingPayload({
        taughtBy: "expert@mcpherson.com",
        text: "answer",
        answersQuestionId: "11111111-1111-4111-8111-111111111111",
      }),
    ).toEqual({
      source: "thinkwork-agent",
      taught_by: "expert@mcpherson.com",
      text: "answer",
      answers_question_id: "11111111-1111-4111-8111-111111111111",
    });
  });

  it("truncates text and identifiers to the Brain's caps", () => {
    const payload = buildBrainTeachingPayload({
      taughtBy: "x".repeat(600),
      text: "y".repeat(5000),
      contextThreadUrl: `https://a.example/${"z".repeat(600)}`,
    });
    expect(payload.taught_by).toHaveLength(BRAIN_TEACHING_MAX_IDENTIFIER_CHARS);
    expect(payload.text).toHaveLength(BRAIN_TEACHING_MAX_TEXT_CHARS);
    expect(payload.context_thread_url).toHaveLength(
      BRAIN_TEACHING_MAX_IDENTIFIER_CHARS,
    );
  });
});

describe("postBrainTeaching", () => {
  const payload = buildBrainTeachingPayload({
    taughtBy: "expert@mcpherson.com",
    text: "teach",
  });

  it("maps a 202 with both ids to acceptance", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(202, { teaching_id: "teach-1", task_id: "task-1" }),
      );
    const result = await postBrainTeaching({
      teachingsUrl: "https://ops.example/teachings",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      kind: "accepted",
      teachingId: "teach-1",
      taskId: "task-1",
      note: null,
    });
    const [url, init] = fetchImpl.mock.calls[0];
    expect(url).toBe("https://ops.example/teachings");
    expect(init.headers.authorization).toBe("Bearer tok");
  });

  it("treats accepted-without-dispatch (note, no task_id) as success", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(
        jsonResponse(202, { teaching_id: "teach-1", note: "queued" }),
      );
    const result = await postBrainTeaching({
      teachingsUrl: "https://ops.example/teachings",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      kind: "accepted",
      teachingId: "teach-1",
      taskId: null,
      note: "queued",
    });
  });

  it("maps a 2xx without a teaching_id to unreachable", async () => {
    const fetchImpl = vi.fn().mockResolvedValue(jsonResponse(200, {}));
    const result = await postBrainTeaching({
      teachingsUrl: "https://ops.example/teachings",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result.kind).toBe("unreachable");
  });

  it("maps a 400 to rejected with the server's message", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(400, { error: "taught_by is required" }));
    const result = await postBrainTeaching({
      teachingsUrl: "https://ops.example/teachings",
      token: "tok",
      payload,
      fetchImpl,
    });
    expect(result).toEqual({
      kind: "rejected",
      status: 400,
      message: "taught_by is required",
    });
  });

  it("maps 5xx and network failures to unreachable", async () => {
    const fetch503 = vi
      .fn()
      .mockResolvedValue(jsonResponse(503, { error: "down" }));
    expect(
      (
        await postBrainTeaching({
          teachingsUrl: "https://ops.example/teachings",
          token: "tok",
          payload,
          fetchImpl: fetch503,
        })
      ).kind,
    ).toBe("unreachable");

    const fetchDown = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(
      (
        await postBrainTeaching({
          teachingsUrl: "https://ops.example/teachings",
          token: "tok",
          payload,
          fetchImpl: fetchDown,
        })
      ).kind,
    ).toBe("unreachable");
  });
});
