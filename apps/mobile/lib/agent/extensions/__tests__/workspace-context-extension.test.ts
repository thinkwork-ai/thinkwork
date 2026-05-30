import { describe, expect, it, vi } from "vitest";
import { loadExtensions } from "../load-extensions";
import { workspaceContextExtension } from "../workspace-context-extension";

const silentLogger = {
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
};

describe("workspaceContextExtension", () => {
  it("injects user USER.md into the system prompt", async () => {
    const getWorkspaceFile = vi.fn().mockImplementation((target, path) => {
      if ("userId" in target && path === "USER.md") {
        return Promise.resolve({
          content: "# USER.md\nThe human's name is Eric Odom.",
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
          deps: { getWorkspaceFile },
        }),
      ],
      { logger: silentLogger },
    );
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });

    expect(getWorkspaceFile).toHaveBeenCalledWith(
      { userId: "user-1" },
      "USER.md",
    );
    expect(composed.systemPrompt).toContain("Use USER.md");
    expect(composed.systemPrompt).toContain("The human's name is Eric Odom.");
  });

  it("leaves the system prompt unchanged when workspace files are missing", async () => {
    const getWorkspaceFile = vi
      .fn()
      .mockResolvedValue({ content: null, source: "user", sha256: "" });

    const loaded = await loadExtensions(
      [
        workspaceContextExtension({
          userId: "user-2",
          deps: { getWorkspaceFile },
        }),
      ],
      { logger: silentLogger },
    );
    const composed = await loaded.dispatch("before_agent_start", {
      systemPrompt: "base",
    });

    expect(composed.systemPrompt).toBe("base");
  });
});
