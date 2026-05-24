import { afterEach, describe, expect, it, vi } from "vitest";

import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

describe("renderWorkspaceAfterCustomize", () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("is a no-op after Customize binding writes", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      renderWorkspaceAfterCustomize(
        "enableWorkflow",
        "agent-primary",
        "computer-1",
      ),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("skips silently when agentId is null", async () => {
    const consoleErrorSpy = vi
      .spyOn(console, "error")
      .mockImplementation(() => {});

    await expect(
      renderWorkspaceAfterCustomize("disableSkill", null, "computer-1"),
    ).resolves.toBeUndefined();

    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });
});
