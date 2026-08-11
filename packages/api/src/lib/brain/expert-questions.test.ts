/**
 * Brain expert-questions client tests (THINK-787): URL derivation,
 * expert matching, question filtering, and GET error mapping.
 */

import { describe, expect, it, vi } from "vitest";
import {
  brainExpertQuestionsUrlFrom,
  brainExpertsUrlFrom,
  getBrainOpsJson,
  matchExpertByEmail,
  questionsForExpert,
  type BrainExpertQuestionRow,
} from "./expert-questions.js";

describe("URL derivation", () => {
  it("derives both endpoints from a bare ops-api origin", () => {
    const base = "https://opsapi.execute-api.us-east-1.amazonaws.com";
    expect(brainExpertQuestionsUrlFrom(base)).toBe(
      `${base}/expert-questions?status=open`,
    );
    expect(brainExpertsUrlFrom(base)).toBe(`${base}/experts`);
  });

  it("strips /mcp suffixes like the flag and teach paths", () => {
    expect(
      brainExpertQuestionsUrlFrom("https://mcp.brain.thinkwork.ai/mcp/twin"),
    ).toBe("https://mcp.brain.thinkwork.ai/expert-questions?status=open");
  });
});

describe("matchExpertByEmail", () => {
  const experts = [
    { id: "e1", email: "Alice@Example.com", product_identity: null },
    { id: "e2", email: null, product_identity: "bob@example.com" },
  ];

  it("matches case-insensitively on email or product_identity", () => {
    expect(matchExpertByEmail(experts, "alice@example.com")?.id).toBe("e1");
    expect(matchExpertByEmail(experts, "BOB@example.com")?.id).toBe("e2");
  });

  it("returns null for unknown or empty emails", () => {
    expect(matchExpertByEmail(experts, "carol@example.com")).toBeNull();
    expect(matchExpertByEmail(experts, "  ")).toBeNull();
  });
});

describe("questionsForExpert", () => {
  const rows: BrainExpertQuestionRow[] = [
    { id: "q1", question: "Oldest?", expert_id: "e1", status: "open" },
    { id: "q2", question: "Unrouted?", expert_id: null, status: "open" },
    { id: "q3", question: "Answered?", expert_id: "e1", status: "answered" },
    { id: "q4", question: "Someone else's?", expert_id: "e2", status: "open" },
    { id: "q5", question: "Newest?", expert_id: "e1", status: "open" },
  ];

  it("keeps only the expert's open questions, preserving order", () => {
    expect(questionsForExpert(rows, "e1").map((q) => q.id)).toEqual([
      "q1",
      "q5",
    ]);
  });
});

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json" },
  });
}

describe("getBrainOpsJson", () => {
  it("returns the parsed body on 200 and sends the bearer", async () => {
    const fetchImpl = vi
      .fn()
      .mockResolvedValue(jsonResponse(200, { experts: [{ id: "e1" }] }));
    const result = await getBrainOpsJson<{ experts: unknown[] }>({
      url: "https://ops.example/experts",
      token: "tok",
      fetchImpl,
    });
    expect(result).toEqual({ kind: "ok", body: { experts: [{ id: "e1" }] } });
    expect(fetchImpl.mock.calls[0][1].headers.authorization).toBe("Bearer tok");
  });

  it("maps HTTP errors and network failures to the error kind", async () => {
    const fetch500 = vi.fn().mockResolvedValue(jsonResponse(500, {}));
    expect(
      (
        await getBrainOpsJson({
          url: "https://ops.example/experts",
          token: "tok",
          fetchImpl: fetch500,
        })
      ).kind,
    ).toBe("error");

    const fetchDown = vi.fn().mockRejectedValue(new Error("ECONNREFUSED"));
    expect(
      (
        await getBrainOpsJson({
          url: "https://ops.example/experts",
          token: "tok",
          fetchImpl: fetchDown,
        })
      ).kind,
    ).toBe("error");
  });
});
