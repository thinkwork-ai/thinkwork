import path from "node:path";
import { describe, expect, it } from "vitest";
import {
  composeSystemPrompt,
  type WorkspaceFileReader,
} from "../src/runtime/system-prompt.js";

function readerFor(files: Record<string, string>): WorkspaceFileReader {
  return async (filePath) => {
    const filename = path.basename(filePath);
    const content = files[filename];
    if (!content) return null;
    const trimmed = content.trim();
    return trimmed || null;
  };
}

describe("composeSystemPrompt", () => {
  // Frozen `now` keeps the date prefix deterministic across runs.
  const now = new Date("2026-05-05T13:00:00Z");

  it("inlines workspace files into the prompt and ignores payload.system_prompt", async () => {
    const prompt = await composeSystemPrompt({
      payload: { system_prompt: "Be precise." },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "USER.md": "## USER\n- Name: Eric Odom",
        "IDENTITY.md": "I am Marco.",
      }),
    });

    expect(prompt).toContain("Eric Odom");
    expect(prompt).toContain("I am Marco.");
    // payload.system_prompt is the legacy DB column — workspace wins when present.
    expect(prompt).not.toContain("Be precise.");
  });

  it("orders system files before user files", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "PLATFORM.md": "PLATFORM_BLOCK",
        "USER.md": "USER_BLOCK",
      }),
    });

    expect(prompt.indexOf("PLATFORM_BLOCK")).toBeLessThan(
      prompt.indexOf("USER_BLOCK"),
    );
  });

  it("prefixes the prompt with the current date", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });
    expect(prompt.startsWith("Current date: ")).toBe(true);
    expect(prompt).toMatch(/Tuesday, May 5, 2026/);
  });

  it("appends workspace skills block when provided", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      workspaceSkillsBlock: "Workspace skills are available.",
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });
    expect(prompt).toContain("Workspace skills are available.");
  });

  it("falls back to payload.system_prompt when workspace is empty", async () => {
    const prompt = await composeSystemPrompt({
      payload: { system_prompt: "Be precise." },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({}),
    });
    expect(prompt).toContain("Be precise.");
  });

  it("falls back to a default Flue prompt when nothing else is available", async () => {
    const prompt = await composeSystemPrompt({
      payload: {
        agent_name: "Researcher",
        tenant_slug: "acme",
        instance_id: "researcher",
      },
      workspaceDir: "/tmp/workspace",
      workspaceSkillsBlock: "Workspace skills are available.",
      now,
      fileReader: readerFor({}),
    });
    expect(prompt).toContain("Researcher");
    expect(prompt).toContain("Flue AgentCore runtime");
    expect(prompt).toContain("Tenant: acme");
    expect(prompt).toContain("Workspace skills are available.");
  });
});
