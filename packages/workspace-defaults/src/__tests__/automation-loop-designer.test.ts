import { describe, expect, it } from "vitest";
import { loadDefaults } from "../index.js";

const defaults = loadDefaults();
const skill = defaults["skills/automation-loop-designer/SKILL.md"];

describe("Automation Loop Designer defaults", () => {
  it("ships a Looper-attributed ThinkWork draft design skill", () => {
    expect(skill).toContain("name: automation-loop-designer");
    expect(skill).toContain("AutomationDraft");
    expect(skill).toContain("https://github.com/ksimback/looper");
    expect(skill).toContain("adaptedFromLicense: MIT");
    expect(skill).toContain("Kevin Simback");
    expect(skill).toContain("ThinkWork remains the orchestrator");
  });

  it("emits ThinkWork-native drafts instead of the Looper runner path", () => {
    expect(skill).toContain('"creationMode": "chat"');
    expect(skill).toContain('"designerSkill": "automation-loop-designer"');
    expect(skill).toContain("Ask for explicit confirmation before save");
    expect(skill).toContain("The agent produces a useful response");
    expect(skill).not.toContain("run-loop.py` as the");
  });
});
