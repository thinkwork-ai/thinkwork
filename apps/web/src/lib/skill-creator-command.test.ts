import { describe, expect, it } from "vitest";
import {
  SKILL_CREATOR_FALLBACK_PROMPT,
  isSkillCreatorSlashQuery,
  normalizeSkillCreatorCommandContent,
} from "./skill-creator-command";

describe("skill creator slash command", () => {
  it("normalizes the slash command into structured metadata", () => {
    expect(
      normalizeSkillCreatorCommandContent(
        "/skill-creator make a skill for customer onboarding",
      ),
    ).toEqual({
      content: "make a skill for customer onboarding",
      command: {
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      },
    });
  });

  it("uses a fallback prompt for command-only sends", () => {
    expect(normalizeSkillCreatorCommandContent("/skill-creator")).toEqual({
      content: SKILL_CREATOR_FALLBACK_PROMPT,
      command: {
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      },
    });
  });

  it("identifies partial reserved-command slash queries", () => {
    expect(isSkillCreatorSlashQuery("skill-cre")).toBe(true);
    expect(isSkillCreatorSlashQuery("")).toBe(false);
    expect(isSkillCreatorSlashQuery("crm")).toBe(false);
    expect(isSkillCreatorSlashQuery(null)).toBe(false);
  });
});
