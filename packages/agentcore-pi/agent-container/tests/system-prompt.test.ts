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
      payload: { system_prompt: "Be precise.", user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "AGENTS.md": "I am Marco.",
        "USER.md": "## USER\n- Name: Eric Odom",
      }),
    });

    expect(prompt).toContain("Eric Odom");
    expect(prompt).toContain("I am Marco.");
    // payload.system_prompt is the legacy DB column — workspace wins when present.
    expect(prompt).not.toContain("Be precise.");
  });

  it("loads the canonical five prompt files in pinned order", async () => {
    // Order contract (see PROMPT_FILES in src/runtime/system-prompt.ts):
    //   AGENTS → CONTEXT → GUARDRAILS → SPACE → USER
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "AGENTS.md": "AGENTS_BLOCK",
        "CONTEXT.md": "CONTEXT_BLOCK",
        "GUARDRAILS.md": "GUARDRAILS_BLOCK",
        "SPACE.md": "SPACE_BLOCK",
        "USER.md": "USER_BLOCK",
      }),
    });

    const positions = {
      AGENTS: prompt.indexOf("AGENTS_BLOCK"),
      CONTEXT: prompt.indexOf("CONTEXT_BLOCK"),
      GUARDRAILS: prompt.indexOf("GUARDRAILS_BLOCK"),
      SPACE: prompt.indexOf("SPACE_BLOCK"),
      USER: prompt.indexOf("USER_BLOCK"),
    };

    expect(positions.AGENTS).toBeLessThan(positions.CONTEXT);
    expect(positions.CONTEXT).toBeLessThan(positions.GUARDRAILS);
    expect(positions.GUARDRAILS).toBeLessThan(positions.SPACE);
    expect(positions.SPACE).toBeLessThan(positions.USER);
  });

  it("does not load retired legacy prompt files even when present on disk", async () => {
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "AGENTS.md": "AGENTS_BLOCK",
        "SOUL.md": "SOUL_BLOCK",
        "IDENTITY.md": "IDENTITY_BLOCK",
        "CAPABILITIES.md": "CAPABILITIES_BLOCK",
        "PLATFORM.md": "PLATFORM_BLOCK",
        "MEMORY_GUIDE.md": "MEMORY_BLOCK",
        "TOOLS.md": "TOOLS_BLOCK",
      }),
    });

    expect(prompt).toContain("AGENTS_BLOCK");
    expect(prompt).not.toContain("SOUL_BLOCK");
    expect(prompt).not.toContain("IDENTITY_BLOCK");
    expect(prompt).not.toContain("CAPABILITIES_BLOCK");
    expect(prompt).not.toContain("PLATFORM_BLOCK");
    expect(prompt).not.toContain("MEMORY_BLOCK");
    expect(prompt).not.toContain("TOOLS_BLOCK");
  });

  it("omits USER.md when there is no invoking user", async () => {
    const prompt = await composeSystemPrompt({
      payload: { eval_mode: true },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({
        "AGENTS.md": "AGENTS_BLOCK",
        "USER.md": "USER_BLOCK",
      }),
    });

    expect(prompt).toContain("AGENTS_BLOCK");
    expect(prompt).not.toContain("USER_BLOCK");
  });

  it("prefixes the prompt with the current date", async () => {
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });
    expect(prompt.startsWith("Current date: ")).toBe(true);
    expect(prompt).toMatch(/Tuesday, May 5, 2026/);
  });

  it("pins the current requester email ahead of tool policy and USER.md", async () => {
    const prompt = await composeSystemPrompt({
      payload: {
        user_id: "user-1",
        current_user_email: "eric@thinkwork.ai",
        current_user_name: "Eric Odom",
      },
      workspaceDir: "/tmp/workspace",
      now,
      fileReader: readerFor({ "USER.md": "USER_BLOCK" }),
    });

    expect(prompt).toContain("<current_requester>");
    expect(prompt).toContain("Name: Eric Odom");
    expect(prompt).toContain("Email: eric@thinkwork.ai");
    expect(prompt).toContain('email "me"');
    expect(prompt.indexOf("<current_requester>")).toBeLessThan(
      prompt.indexOf("## Runtime Tool Policy"),
    );
    expect(prompt.indexOf("## Runtime Tool Policy")).toBeLessThan(
      prompt.indexOf("USER_BLOCK"),
    );
  });

  it("injects a runtime tool policy when execute_code is unavailable", async () => {
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      availableToolNames: ["send_email"],
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });

    expect(prompt).toContain("## Runtime Tool Policy");
    expect(prompt).toContain("The Pi host `bash` tool is not available");
    expect(prompt).toContain("The `execute_code` tool is not available");
    expect(prompt).toContain(
      "do not run code, simulate execution, or invent command output",
    );
    expect(prompt).toContain('Do not treat vague phrases like "send me"');
  });

  it("instructs the agent to use execute_code when it is available", async () => {
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      availableToolNames: ["execute_code", "send_email"],
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });

    expect(prompt).toContain("The `execute_code` tool is available");
    expect(prompt).toContain(
      "Never claim that code ran, tests passed, a command produced output",
    );
    expect(prompt).toContain("The `send_email` tool is available");
  });

  it("distinguishes host-contained bash from the Code Interpreter sandbox", async () => {
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
      workspaceDir: "/tmp/workspace",
      availableToolNames: ["bash", "execute_code"],
      now,
      fileReader: readerFor({ "USER.md": "X" }),
    });

    expect(prompt).toContain("Pi host `bash` tool is available");
    expect(prompt).toContain("contained workspace sandbox");
    expect(prompt).toContain("Treat `bash` and `execute_code` as distinct");
    expect(prompt).toContain("use `bash` for the Pi workspace/shell");
  });

  it("appends workspace skills block when provided", async () => {
    const prompt = await composeSystemPrompt({
      payload: { user_id: "user-1" },
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
