import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const { mockRegenerateWorkspaceMap } = vi.hoisted(() => ({
  mockRegenerateWorkspaceMap: vi.fn(),
}));

vi.mock("../../../lib/workspace-map-generator.js", () => ({
  regenerateWorkspaceMap: mockRegenerateWorkspaceMap,
}));

import { renderWorkspaceAfterCustomize } from "./render-workspace-after-customize.js";

describe("renderWorkspaceAfterCustomize", () => {
  let consoleErrorSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    mockRegenerateWorkspaceMap.mockReset();
    consoleErrorSpy = vi.spyOn(console, "error").mockImplementation(() => {});
  });

  afterEach(() => {
    consoleErrorSpy.mockRestore();
  });

  it("invokes the renderer with (agentId, computerId) on the happy path", async () => {
    mockRegenerateWorkspaceMap.mockResolvedValue(undefined);
    await renderWorkspaceAfterCustomize(
      "enableWorkflow",
      "agent-primary",
      "computer-1",
    );
    expect(mockRegenerateWorkspaceMap).toHaveBeenCalledTimes(1);
    expect(mockRegenerateWorkspaceMap).toHaveBeenCalledWith(
      "agent-primary",
      "computer-1",
    );
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("skips silently when agentId is null (no primary agent → no workspace)", async () => {
    await renderWorkspaceAfterCustomize(
      "disableSkill",
      null,
      "computer-1",
    );
    expect(mockRegenerateWorkspaceMap).not.toHaveBeenCalled();
    expect(consoleErrorSpy).not.toHaveBeenCalled();
  });

  it("logs but does not throw when the renderer rejects (binding write already committed)", async () => {
    const boom = new Error("S3 throttled");
    mockRegenerateWorkspaceMap.mockRejectedValue(boom);
    await expect(
      renderWorkspaceAfterCustomize(
        "enableSkill",
        "agent-primary",
        "computer-1",
      ),
    ).resolves.toBeUndefined();
    expect(consoleErrorSpy).toHaveBeenCalledTimes(1);
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toMatch(
      /\[enableSkill\] regenerateWorkspaceMap failed/i,
    );
    expect(consoleErrorSpy.mock.calls[0]?.[1]).toBe(boom);
  });

  it("logs include the resolver name so CloudWatch filters per-mutation work", async () => {
    mockRegenerateWorkspaceMap.mockRejectedValue(new Error("disk full"));
    await renderWorkspaceAfterCustomize(
      "disableWorkflow",
      "agent-primary",
      "computer-1",
    );
    expect(consoleErrorSpy.mock.calls[0]?.[0]).toMatch(
      /\[disableWorkflow\]/,
    );
  });
});
