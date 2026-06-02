import { describe, expect, it } from "vitest";
import {
  isStartEvaluationDisabled,
  shouldShowDesktopPiEvalTarget,
} from "./SettingsEvaluations";

describe("SettingsEvaluations target selection", () => {
  it("shows Desktop Pi only when the desktop bridge reports a visible state", () => {
    expect(shouldShowDesktopPiEvalTarget("available")).toBe(true);
    expect(shouldShowDesktopPiEvalTarget("starting")).toBe(true);
    expect(shouldShowDesktopPiEvalTarget("busy")).toBe(true);
    expect(shouldShowDesktopPiEvalTarget("unavailable")).toBe(true);
    expect(shouldShowDesktopPiEvalTarget("hidden")).toBe(false);
  });

  it("disables starts while submitting, without a model, or for unavailable Desktop Pi", () => {
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "moonshotai.kimi-k2.5",
        target: "cloud",
        desktopPiEnabled: false,
      }),
    ).toBe(false);
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "moonshotai.kimi-k2.5",
        target: "desktop-pi",
        desktopPiEnabled: false,
      }),
    ).toBe(true);
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "moonshotai.kimi-k2.5",
        target: "desktop-pi",
        desktopPiEnabled: true,
      }),
    ).toBe(false);
    expect(
      isStartEvaluationDisabled({
        submitting: true,
        selectedModel: "moonshotai.kimi-k2.5",
        target: "cloud",
        desktopPiEnabled: true,
      }),
    ).toBe(true);
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "",
        target: "cloud",
        desktopPiEnabled: true,
      }),
    ).toBe(true);
  });
});
