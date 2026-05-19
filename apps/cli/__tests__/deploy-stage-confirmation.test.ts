import { describe, expect, it, vi } from "vitest";

import { confirmLocalDeployStage } from "../src/commands/deploy.js";

describe("local deploy stage confirmation", () => {
  it("uses the resolved stage when the user confirms it", async () => {
    const confirm = vi.fn(async () => true);
    const promptInput = vi.fn();

    await expect(
      confirmLocalDeployStage(
        "dev",
        {},
        { confirm, promptInput, stdoutIsTty: true },
      ),
    ).resolves.toBe("dev");

    expect(confirm).toHaveBeenCalledWith('  Deploy to stage "dev"?');
    expect(promptInput).not.toHaveBeenCalled();
  });

  it("prompts for a replacement stage when the user declines the resolved stage", async () => {
    const confirm = vi
      .fn<() => Promise<boolean>>()
      .mockResolvedValueOnce(false)
      .mockResolvedValueOnce(true);
    const promptInput = vi.fn(async () => "qa");

    await expect(
      confirmLocalDeployStage(
        "dev",
        {},
        { confirm, promptInput, stdoutIsTty: true },
      ),
    ).resolves.toBe("qa");

    expect(promptInput).toHaveBeenCalledWith(
      'Deployment stage to deploy instead of "dev" (blank to abort):',
    );
    expect(confirm).toHaveBeenNthCalledWith(2, '  Deploy to stage "qa"?');
  });

  it("aborts after a declined stage in non-interactive sessions", async () => {
    const confirm = vi.fn(async () => false);

    await expect(
      confirmLocalDeployStage("dev", {}, { confirm, stdoutIsTty: false }),
    ).resolves.toBeNull();
  });

  it("validates replacement stage names", async () => {
    const confirm = vi.fn(async () => false);
    const promptInput = vi.fn(async () => "INVALID_UPPERCASE");

    await expect(
      confirmLocalDeployStage(
        "dev",
        {},
        { confirm, promptInput, stdoutIsTty: true },
      ),
    ).rejects.toThrow(/Invalid stage name/);
  });
});
