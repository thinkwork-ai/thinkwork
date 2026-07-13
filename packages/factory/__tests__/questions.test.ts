/**
 * Answer forms: the ```answers fence parser (tolerant, ledger-style — never
 * throws) and the Block Kit builders (recommended styling, action_id/value
 * shape, Slack limits: 75-char button labels, 2000-char values, 3000-char
 * sections).
 */

import { describe, expect, it } from "vitest";

import {
  buildQuestionBlocks,
  buildRetryBlocks,
  parseAnswerForm,
  type AnswerButtonValue,
} from "../src/slack/questions.js";

const FENCED = (yaml: string) => "blocker:THINK-1:implement — @eric1\n\nQuestions:\n1. Which scope?\n\n```answers\n" + yaml + "\n```\n";

type Block = {
  type: string;
  text?: { type: string; text: string };
  elements?: Array<{
    type: string;
    action_id: string;
    text: { type: string; text: string };
    value: string;
    style?: string;
  }>;
};

describe("parseAnswerForm", () => {
  it("parses a multi-question fence and normalizes recommended to 0-based", () => {
    const body = FENCED(
      [
        "- question: Which OAuth scope?",
        "  recommended: 1",
        "  options:",
        "    - Read-only (drive.readonly)",
        "    - Full drive access",
        "- question: Ship behind a flag?",
        "  recommended: 2",
        "  options:",
        "    - Yes, flagged",
        "    - No, ship live",
      ].join("\n"),
    );
    const form = parseAnswerForm(body);
    expect(form).not.toBeNull();
    expect(form!.questions).toHaveLength(2);
    expect(form!.questions[0]).toEqual({
      question: "Which OAuth scope?",
      options: ["Read-only (drive.readonly)", "Full drive access"],
      recommended: 0,
    });
    expect(form!.questions[1].recommended).toBe(1);
  });

  it("uses the LAST answers fence when several exist", () => {
    const body =
      "```answers\n- question: Old?\n  recommended: 1\n  options: [a]\n```\n\nrevised:\n\n```answers\n- question: New?\n  recommended: 1\n  options: [b]\n```\n";
    const form = parseAnswerForm(body);
    expect(form!.questions[0].question).toBe("New?");
  });

  it("returns null when there is no fence", () => {
    expect(parseAnswerForm("blocker: just prose questions")).toBeNull();
  });

  it("returns null on invalid YAML (never throws)", () => {
    expect(parseAnswerForm("```answers\n- question: [unclosed\n```")).toBeNull();
  });

  it("returns null on a non-list fence or an empty list", () => {
    expect(parseAnswerForm("```answers\nquestion: not a list\n```")).toBeNull();
    expect(parseAnswerForm("```answers\n[]\n```")).toBeNull();
  });

  it("drops malformed entries but keeps the valid ones", () => {
    const body = FENCED(
      [
        "- question: Valid?",
        "  recommended: 1",
        "  options: [yes, no]",
        "- 42",
        "- question: ''",
        "  options: [x]",
        "- question: No options",
        "  options: []",
        "- question: Non-string options dropped",
        "  options: [ok, 7, null]",
      ].join("\n"),
    );
    const form = parseAnswerForm(body);
    expect(form!.questions).toHaveLength(2);
    expect(form!.questions[0].question).toBe("Valid?");
    // Non-string options are filtered out, string ones survive.
    expect(form!.questions[1].options).toEqual(["ok"]);
  });

  it("out-of-range or missing recommended normalizes to null (entry kept)", () => {
    const form = parseAnswerForm(
      FENCED("- question: Q?\n  recommended: 9\n  options: [a, b]"),
    );
    expect(form!.questions[0].recommended).toBeNull();
    const noRec = parseAnswerForm(FENCED("- question: Q?\n  options: [a, b]"));
    expect(noRec!.questions[0].recommended).toBeNull();
  });
});

describe("buildQuestionBlocks", () => {
  const form = {
    questions: [
      {
        question: "Which OAuth scope?",
        options: ["Read-only (drive.readonly)", "Full drive access"],
        recommended: 0,
      },
    ],
  };

  it("renders body section, question section, option buttons, and the Other button", () => {
    const blocks = buildQuestionBlocks("THINK-1", "q-1", form, "escalation text") as Block[];
    expect(blocks[0]).toMatchObject({
      type: "section",
      text: { type: "mrkdwn", text: "escalation text" },
    });
    expect(blocks[1].text!.text).toBe("*Q1.* Which OAuth scope?");
    const buttons = blocks[2].elements!;
    expect(buttons.map((b) => b.action_id)).toEqual([
      "factory-answer:0:0",
      "factory-answer:0:1",
    ]);
    // Recommended: primary style + ✅ prefix; the other gets neither.
    expect(buttons[0].style).toBe("primary");
    expect(buttons[0].text.text).toBe("✅ Read-only (drive.readonly)");
    expect(buttons[1].style).toBeUndefined();
    // Value JSON carries the full answer text.
    const value = JSON.parse(buttons[0].value) as AnswerButtonValue;
    expect(value).toEqual({
      key: "q-1",
      q: 0,
      o: 0,
      answer: "Q1: Read-only (drive.readonly)",
    });
    // Final actions block: the Other escape hatch.
    const last = blocks[blocks.length - 1];
    expect(last.type).toBe("actions");
    expect(last.elements![0].action_id).toBe("factory-answer-other");
    expect(JSON.parse(last.elements![0].value)).toEqual({ key: "q-1" });
  });

  it("truncates button labels to Slack's 75-char limit but keeps the full answer in value", () => {
    const long = "x".repeat(200);
    const blocks = buildQuestionBlocks(
      "THINK-1",
      "k",
      { questions: [{ question: "Q?", options: [long], recommended: 0 }] },
      "t",
    ) as Block[];
    const button = blocks[2].elements![0];
    expect(button.text.text.length).toBeLessThanOrEqual(75);
    const value = JSON.parse(button.value) as AnswerButtonValue;
    expect(value.answer).toBe(`Q1: ${long}`); // full label survives in value
  });

  it("caps the value's answer near 1800 so the 2000-char value limit holds", () => {
    const huge = "y".repeat(5000);
    const blocks = buildQuestionBlocks(
      "THINK-1",
      "k",
      { questions: [{ question: "Q?", options: [huge], recommended: null }] },
      "t",
    ) as Block[];
    const button = blocks[2].elements![0];
    expect(button.value.length).toBeLessThanOrEqual(2000);
  });

  it("truncates an over-limit body section with a pointer to Linear", () => {
    const blocks = buildQuestionBlocks("THINK-1", "k", form, "z".repeat(4000)) as Block[];
    const text = blocks[0].text!.text;
    expect(text.length).toBeLessThanOrEqual(3000);
    expect(text).toContain("(truncated — full question in Linear)");
  });
});

describe("buildRetryBlocks", () => {
  it("renders the text plus retry (primary) and Other buttons", () => {
    const blocks = buildRetryBlocks("THINK-1", "fb-1", "blocked text") as Block[];
    expect(blocks[0].text!.text).toBe("blocked text");
    const buttons = blocks[1].elements!;
    expect(buttons[0].action_id).toBe("factory-answer-retry");
    expect(buttons[0].style).toBe("primary");
    expect(buttons[0].text.text).toContain("Clear blocker & retry");
    expect(JSON.parse(buttons[0].value)).toEqual({ key: "fb-1" });
    expect(buttons[1].action_id).toBe("factory-answer-other");
  });
});
