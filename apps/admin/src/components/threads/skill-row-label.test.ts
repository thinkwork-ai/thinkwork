import { describe, expect, it } from "vitest";
import { extractSkillName } from "./skill-row-label";

describe("extractSkillName", () => {
  it("returns the slug from a `skills` tool with skill_name in input", () => {
    expect(
      extractSkillName(
        "skills",
        '{"skill_name": "finance-statement-analysis"}',
      ),
    ).toBe("finance-statement-analysis");
  });

  it("accepts the capitalized 'Skill' meta-tool name with skill_name", () => {
    expect(
      extractSkillName("Skill", '{"skill_name": "sales-prep"}'),
    ).toBe("sales-prep");
  });

  it("accepts the `name` field as a fallback (in-house meta-tool shape)", () => {
    expect(
      extractSkillName("Skill", '{"name": "finance-audit-xls"}'),
    ).toBe("finance-audit-xls");
  });

  it("returns null for non-skills tools regardless of input shape", () => {
    expect(
      extractSkillName("file_read", '{"path": "/tmp/x.xlsx"}'),
    ).toBeNull();
    expect(
      extractSkillName("delegate", '{"task": "..."}'),
    ).toBeNull();
  });

  it("returns null when input is missing or empty", () => {
    expect(extractSkillName("skills", undefined)).toBeNull();
    expect(extractSkillName("skills", "")).toBeNull();
  });

  it("returns null for malformed JSON (caught defensively)", () => {
    expect(extractSkillName("skills", "{not json")).toBeNull();
  });

  it("returns null when skill_name is empty / whitespace-only", () => {
    expect(extractSkillName("skills", '{"skill_name": "   "}')).toBeNull();
    expect(extractSkillName("skills", '{"skill_name": ""}')).toBeNull();
  });

  it("returns null when skill_name is the wrong type", () => {
    expect(extractSkillName("skills", '{"skill_name": 42}')).toBeNull();
    expect(extractSkillName("skills", '{"skill_name": null}')).toBeNull();
  });

  it("trims surrounding whitespace from the slug", () => {
    expect(
      extractSkillName("skills", '{"skill_name": "  finance-audit-xls  "}'),
    ).toBe("finance-audit-xls");
  });

  it("ignores undefined toolName defensively", () => {
    expect(extractSkillName(undefined, '{"skill_name": "x"}')).toBeNull();
  });
});
