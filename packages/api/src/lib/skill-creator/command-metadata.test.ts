import { describe, expect, it } from "vitest";
import {
  SKILL_CREATOR_FALLBACK_PROMPT,
  appendSkillCreatorCommandMetadata,
  normalizeSkillCreatorCommandContent,
  parseSkillCreatorCommandMetadata,
  toRuntimeSkillCreatorCommandPayload,
} from "./command-metadata.js";

describe("skill creator command metadata", () => {
  it("strips the slash command and returns structured metadata", () => {
    expect(
      normalizeSkillCreatorCommandContent(
        "/skill-creator build a skill for invoice triage",
      ),
    ).toEqual({
      content: "build a skill for invoice triage",
      command: {
        type: "skill_creator",
        source: "slash_command",
        command: "/skill-creator",
      },
    });
  });

  it("keeps command-only submissions dispatchable with a fallback prompt", () => {
    expect(normalizeSkillCreatorCommandContent("/skill-creator").content).toBe(
      SKILL_CREATOR_FALLBACK_PROMPT,
    );
  });

  it("does not match partial skill catalog slash commands", () => {
    expect(normalizeSkillCreatorCommandContent("/skill").command).toBeNull();
    expect(
      normalizeSkillCreatorCommandContent("/skill-creatorish please").command,
    ).toBeNull();
  });

  it("round-trips message metadata into the runtime command payload", () => {
    const normalized = normalizeSkillCreatorCommandContent("/skill-creator");
    const metadata = appendSkillCreatorCommandMetadata({}, normalized.command);

    expect(parseSkillCreatorCommandMetadata(metadata)).toEqual(
      normalized.command,
    );
    expect(toRuntimeSkillCreatorCommandPayload(normalized.command)).toEqual({
      type: "skill_creator",
      source: "slash_command",
      command: "/skill-creator",
      draftApi: {
        target: "skillDraftId",
        workspaceFilesApi: "/api/workspaces/files",
      },
    });
  });
});
