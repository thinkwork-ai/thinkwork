/**
 * Pure-helper tests for the ask_user_question message contract:
 * boundary acceptance for the validator and the markdown fallback
 * rendering. Endpoint-level rejection paths live in intake.test.ts.
 * Plan 2026-06-09-005 U2.
 */

import { describe, expect, it } from "vitest";
import {
  MAX_HEADER_CHARS,
  MAX_LABEL_CHARS,
  renderQuestionMarkdown,
  userQuestionPart,
  validateQuestionBatch,
  type UserQuestionInput,
} from "./question-message.js";

function q(overrides: Partial<UserQuestionInput> = {}): UserQuestionInput {
  return {
    question: "Which one?",
    header: "Choice",
    options: [
      { label: "A", description: "first" },
      { label: "B", description: "" },
    ],
    ...overrides,
  };
}

describe("validateQuestionBatch — boundary acceptance", () => {
  it("accepts exactly 4 questions with 4 options each", () => {
    const four = (header: string) => ({
      ...q({ header }),
      options: [
        { label: "A", description: "" },
        { label: "B", description: "" },
        { label: "C", description: "" },
        { label: "D", description: "" },
      ],
    });
    expect(
      validateQuestionBatch(
        [four("One"), four("Two"), four("Three"), four("Four")],
        undefined,
      ),
    ).toBeNull();
  });

  it("rejects duplicate question headers (card answers are keyed by header)", () => {
    expect(
      validateQuestionBatch(
        [q({ header: "Env" }), q({ header: "Env" })],
        undefined,
      ),
    ).toContain("duplicates an earlier question header");
  });

  it("rejects duplicate headers case-insensitively and after trimming", () => {
    expect(
      validateQuestionBatch(
        [q({ header: "Env" }), q({ header: " env " })],
        undefined,
      ),
    ).toContain("duplicates an earlier question header");
  });

  it("accepts distinct headers", () => {
    expect(
      validateQuestionBatch(
        [q({ header: "Env" }), q({ header: "Region" })],
        undefined,
      ),
    ).toBeNull();
  });

  it("accepts a header of exactly 12 chars and a label of exactly 60", () => {
    const boundary = q({
      header: "h".repeat(MAX_HEADER_CHARS),
      options: [
        { label: "x".repeat(MAX_LABEL_CHARS), description: "" },
        { label: "B", description: "" },
      ],
    });
    expect(validateQuestionBatch([boundary], undefined)).toBeNull();
  });

  it("accepts multiSelect=true and a delegation_context object", () => {
    expect(
      validateQuestionBatch([q({ multiSelect: true })], {
        profileSlug: "researcher",
      }),
    ).toBeNull();
  });

  it("rejects non-boolean multiSelect", () => {
    expect(
      validateQuestionBatch(
        [q({ multiSelect: "yes" as unknown as boolean })],
        undefined,
      ),
    ).toContain("multiSelect");
  });

  it("rejects a non-object delegation_context", () => {
    expect(validateQuestionBatch([q()], ["nope"])).toContain(
      "delegation_context",
    );
  });

  it("counts delegation_context toward the 8 KB cap", () => {
    expect(validateQuestionBatch([q()], { blob: "z".repeat(9000) })).toContain(
      "8192",
    );
  });
});

describe("renderQuestionMarkdown", () => {
  it("renders header, question, and options as a bulleted list", () => {
    const md = renderQuestionMarkdown([q()]);
    expect(md).toContain("**Choice**");
    expect(md).toContain("Which one?");
    expect(md).toContain("- A — first");
    // Empty description renders the bare label, no dangling dash.
    expect(md).toContain("- B");
    expect(md).not.toContain("- B —");
  });

  it("flags multi-select questions in the text fallback", () => {
    const md = renderQuestionMarkdown([q({ multiSelect: true })]);
    expect(md).toContain("select all that apply");
  });

  it("separates multiple questions with blank lines", () => {
    const md = renderQuestionMarkdown([
      q(),
      q({ header: "Second", question: "And this?" }),
    ]);
    expect(md.indexOf("**Choice**")).toBeLessThan(md.indexOf("**Second**"));
    expect(md).toContain("\n\n**Second**");
  });
});

describe("userQuestionPart", () => {
  it("builds the data-user-question part with questions only (no answer state)", () => {
    const part = userQuestionPart("q-1", [q()]);
    expect(part).toEqual({
      type: "data-user-question",
      questionId: "q-1",
      questions: [q()],
    });
    expect(Object.keys(part).sort()).toEqual([
      "questionId",
      "questions",
      "type",
    ]);
  });
});
