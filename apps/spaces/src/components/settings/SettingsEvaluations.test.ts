import { describe, expect, it } from "vitest";
import {
  evalRunCategoryLabel,
  evalRunSourceKind,
  isEvaluationDashboardRefreshActive,
  isDesktopPiEvalParallelThreadsValid,
  isStartEvaluationDisabled,
  normalizeDesktopPiEvalParallelThreads,
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

  it("labels all-category runs and source provenance clearly", () => {
    expect(evalRunCategoryLabel([])).toBe("All Categories");
    expect(evalRunCategoryLabel(["red-team-data-boundary"])).toBe(
      "red-team-data-boundary",
    );
    expect(
      evalRunCategoryLabel([
        "red-team-data-boundary",
        "red-team-prompt-injection",
      ]),
    ).toBe("2 Categories");

    expect(
      evalRunSourceKind({
        executionTarget: "desktop-pi",
        runtimeHost: "desktop-local",
        scheduledJobId: null,
      }),
    ).toBe("desktop-pi");
    expect(
      evalRunSourceKind({
        executionTarget: "cloud",
        runtimeHost: "agentcore",
        scheduledJobId: null,
      }),
    ).toBe("agentcore-pi");
    expect(
      evalRunSourceKind({
        executionTarget: "cloud",
        runtimeHost: "agentcore",
        scheduledJobId: "job-1",
      }),
    ).toBe("schedule");
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
        desktopPiParallelThreads: "0",
      }),
    ).toBe(true);
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "moonshotai.kimi-k2.5",
        target: "desktop-pi",
        desktopPiEnabled: true,
        desktopPiParallelThreads: "3",
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

  it("validates and normalizes Desktop Pi parallel threads", () => {
    expect(isDesktopPiEvalParallelThreadsValid("1")).toBe(true);
    expect(isDesktopPiEvalParallelThreadsValid("3")).toBe(true);
    expect(isDesktopPiEvalParallelThreadsValid("8")).toBe(true);
    expect(isDesktopPiEvalParallelThreadsValid("0")).toBe(false);
    expect(isDesktopPiEvalParallelThreadsValid("9")).toBe(false);
    expect(isDesktopPiEvalParallelThreadsValid("two")).toBe(false);

    expect(normalizeDesktopPiEvalParallelThreads("")).toBe(1);
    expect(normalizeDesktopPiEvalParallelThreads("0")).toBe(1);
    expect(normalizeDesktopPiEvalParallelThreads("3")).toBe(3);
    expect(normalizeDesktopPiEvalParallelThreads("12")).toBe(8);
  });

  it("treats manual and query fetches as active dashboard refreshes", () => {
    expect(
      isEvaluationDashboardRefreshActive({
        manualRefreshing: false,
        summaryFetching: false,
        runsFetching: false,
        seriesFetching: false,
      }),
    ).toBe(false);

    expect(
      isEvaluationDashboardRefreshActive({
        manualRefreshing: true,
        summaryFetching: false,
        runsFetching: false,
        seriesFetching: false,
      }),
    ).toBe(true);

    expect(
      isEvaluationDashboardRefreshActive({
        manualRefreshing: false,
        summaryFetching: false,
        runsFetching: false,
        seriesFetching: true,
      }),
    ).toBe(true);
  });
});
