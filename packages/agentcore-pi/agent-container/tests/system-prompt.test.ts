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

  it("places the routing map and safety floor before user context, and platform/memory reference after", async () => {
    // Order contract (see PROMPT_FILES in src/runtime/system-prompt.ts):
    //   AGENTS → GUARDRAILS → SOUL → IDENTITY → USER → CONTEXT
    //          → PLATFORM → MEMORY_GUIDE → TOOLS
    // The model anchors on the start + end positions; map + safety go up
    // front, user context next, reference material toward the back.
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "AGENTS.md": "AGENTS_BLOCK",
        "GUARDRAILS.md": "GUARDRAILS_BLOCK",
        "USER.md": "USER_BLOCK",
        "PLATFORM.md": "PLATFORM_BLOCK",
        "MEMORY_GUIDE.md": "MEMORY_BLOCK",
        "TOOLS.md": "TOOLS_BLOCK",
      }),
    });

    const positions = {
      AGENTS: prompt.indexOf("AGENTS_BLOCK"),
      GUARDRAILS: prompt.indexOf("GUARDRAILS_BLOCK"),
      USER: prompt.indexOf("USER_BLOCK"),
      PLATFORM: prompt.indexOf("PLATFORM_BLOCK"),
      MEMORY: prompt.indexOf("MEMORY_BLOCK"),
      TOOLS: prompt.indexOf("TOOLS_BLOCK"),
    };

    // Map first, safety second
    expect(positions.AGENTS).toBeLessThan(positions.GUARDRAILS);
    // Safety floor before user-specific context
    expect(positions.GUARDRAILS).toBeLessThan(positions.USER);
    // User context before platform/reference material
    expect(positions.USER).toBeLessThan(positions.PLATFORM);
    // Platform before memory guide
    expect(positions.PLATFORM).toBeLessThan(positions.MEMORY);
    // Tools last
    expect(positions.MEMORY).toBeLessThan(positions.TOOLS);
  });

  it("does not load CAPABILITIES.md even when present on disk", async () => {
    // CAPABILITIES.md retired from the loader on 2026-05-24 — see PROMPT_FILES.
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "CAPABILITIES.md": "CAPABILITIES_BLOCK",
        "PLATFORM.md": "PLATFORM_BLOCK",
      }),
    });

    expect(prompt).not.toContain("CAPABILITIES_BLOCK");
    expect(prompt).toContain("PLATFORM_BLOCK");
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

  it("injects a runtime tool policy when execute_code is unavailable", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      availableToolNames: ["send_email"],
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });

    expect(prompt).toContain("## Runtime Tool Policy");
    expect(prompt).toContain("The `execute_code` tool is not available");
    expect(prompt).toContain("Do not run code, simulate code execution");
    expect(prompt).toContain('Do not treat vague phrases like "send me"');
  });

  it("instructs the agent to use execute_code when it is available", async () => {
    const prompt = await composeSystemPrompt({
      payload: {},
      workspaceDir: "/tmp/workspace",
      availableToolNames: ["execute_code", "send_email"],
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });

    expect(prompt).toContain("The `execute_code` tool is available");
    expect(prompt).toContain(
      "Never claim that code ran, tests passed, a script produced output",
    );
    expect(prompt).toContain("The `send_email` tool is available");
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

  it("falls back to a default Pi prompt when nothing else is available", async () => {
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
    expect(prompt).toContain("Pi AgentCore runtime");
    expect(prompt).toContain("Tenant: acme");
    expect(prompt).toContain("Workspace skills are available.");
  });
});
