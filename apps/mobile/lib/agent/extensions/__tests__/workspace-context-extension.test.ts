import { beforeEach, describe, expect, it, vi } from "vitest";
import { loadExtensions } from "../load-extensions";
import {
  clearWorkspaceContextCache,
  workspaceContextExtension,
} from "../workspace-context-extension";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

const FIXED_NOW = new Date("2026-05-30T12:00:00Z");

describe("workspaceContextExtension", () => {
  beforeEach(() => {
    clearWorkspaceContextCache();
  });

  it("composes USER.md through the shared ThinkWork system-prompt order", async () => {
    const getWorkspaceFile = vi.fn().mockImplementation((target, path) => {
      if ("agentId" in target && path === "AGENTS.md") {
        return Promise.resolve({
          content: "AGENTS BODY",
          source: "agent",
          sha256: "",
        });
      }
      if ("agentId" in target && path === "GUARDRAILS.md") {
        return Promise.resolve({
          content: "GUARDRAILS BODY",
          source: "agent",
          sha256: "",
        });
      }
      if ("spaceId" in target && path === "SPACE.md") {
        return Promise.resolve({
          content: "SPACE BODY",
          source: "space",
          sha256: "",
        });
      }
      if ("userId" in target && path === "USER.md") {
        return Promise.resolve({
          content: "The human's name is Eric Odom.",
          source: "user",
          sha256: "",
        });
      }
      return Promise.resolve({ content: null, source: "agent", sha256: "" });
    });

    const loaded = await loadExtensions(
      [
        workspaceContextExtension({
          userId: "user-1",
          userName: "Eric",
          userEmail: "eric@example.com",
          agentId: "agent-1",
          spaceId: "space-1",
          now: FIXED_NOW,
          deps: { getWorkspaceFile },
        }),
      ],
      { logger: silentLogger },
    );
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
      toolNames: ["bash", "execute_code"],
    });

    expect(composed.systemPrompt).toContain("Current date:");
    expect(composed.systemPrompt).toContain("<current_requester>");
    expect(composed.systemPrompt).toContain("eric@example.com");
    expect(composed.systemPrompt).toContain(
      "Pi built-in `bash` tool is available",
    );
    expect(composed.systemPrompt).toContain("`execute_code` tool is available");
    expect(composed.systemPrompt).toContain("AGENTS BODY");
    expect(composed.systemPrompt).toContain("GUARDRAILS BODY");
    expect(composed.systemPrompt).toContain("SPACE BODY");
    expect(composed.systemPrompt).toContain("The human's name is Eric Odom.");
    expect(composed.systemPrompt.indexOf("AGENTS BODY")).toBeLessThan(
      composed.systemPrompt.indexOf("The human's name is Eric Odom."),
    );
    expect(composed.systemPrompt).toContain("## Mobile Host");
  });

  it("uses cached workspace files on a warm context load", async () => {
    const getWorkspaceFile = vi.fn().mockImplementation((target, path) => {
      if ("userId" in target && path === "USER.md") {
        return Promise.resolve({
          content: "The human's name is Eric Odom.",
          source: "user",
          sha256: "",
        });
      }
      return Promise.resolve({ content: null, source: "user", sha256: "" });
    });
    const ext = workspaceContextExtension({
      userId: "user-1",
      now: FIXED_NOW,
      deps: { getWorkspaceFile },
    });

    const first = await loadExtensions([ext], { logger: silentLogger });
    await first.dispatch("before_agent_start", { systemPrompt: "base" });
    const second = await loadExtensions([ext], { logger: silentLogger });
    const composed = await second.dispatch("before_agent_start", {
      systemPrompt: "base",
    });

    expect(getWorkspaceFile).toHaveBeenCalledTimes(1);
    expect(composed.systemPrompt).toContain("The human's name is Eric Odom.");
  });

  it("falls back to the incoming mobile prompt when workspace files are missing", async () => {
    const getWorkspaceFile = vi
      .fn()
      .mockResolvedValue({ content: null, source: "user", sha256: "" });

    const loaded = await loadExtensions(
      [
        workspaceContextExtension({
          userId: "user-2",
          now: FIXED_NOW,
          deps: { getWorkspaceFile },
        }),
      ],
      { logger: silentLogger },
    );
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base mobile prompt",
      toolNames: [],
    });

    expect(composed.systemPrompt).toContain("base mobile prompt");
    expect(composed.systemPrompt).toContain("`bash` tool is not available");
    expect(composed.systemPrompt).toContain("## Mobile Host");
  });
});
