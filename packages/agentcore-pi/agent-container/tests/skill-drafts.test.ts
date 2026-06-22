import { describe, expect, it } from "vitest";
import {
  SKILL_CREATOR_WORKSPACE_SKILL_SLUG,
  formatSkillCreatorCommandContext,
  parseSkillCreatorCommandPayload,
} from "../src/runtime/skill-drafts.js";

describe("skill creator runtime command context", () => {
  it("parses the dispatch payload shape", () => {
    expect(
      parseSkillCreatorCommandPayload({
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
        draftApi: {
          target: "skillDraftId",
          workspaceFilesApi: "/api/workspaces/files",
        },
      }),
    ).toEqual({
      type: "skill_creator",
      source: "slash_command",
      command: "/skill-creator",
      draftApi: {
        target: "skillDraftId",
        workspaceFilesApi: "/api/workspaces/files",
      },
    });
  });

  it("rejects unrelated command payloads", () => {
    expect(
      parseSkillCreatorCommandPayload({
        type: "other",
        command: "/skill-creator",
      }),
    ).toBeNull();
    expect(parseSkillCreatorCommandPayload(null)).toBeNull();
  });

  it("formats a command preamble that points at the upstream workspace skill", () => {
    const block = formatSkillCreatorCommandContext(
      parseSkillCreatorCommandPayload({
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      }),
    );

    expect(block).toContain("The user invoked /skill-creator");
    expect(block).toContain(SKILL_CREATOR_WORKSPACE_SKILL_SLUG);
    expect(block).toContain("skills/<skill-slug>/");
    expect(block).toContain("YAML frontmatter");
    expect(block).toContain("name: <skill-slug>");
    expect(block).toContain("register the changed skill folder");
    expect(block).toContain("Do not ask the user for skillDraftId");
    expect(block).toContain("until the user approves it");
  });
});
