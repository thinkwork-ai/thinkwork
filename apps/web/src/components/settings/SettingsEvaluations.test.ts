import { describe, expect, it } from "vitest";
import {
  buildStartEvalRunInput,
  evalRunCategoryLabel,
  evalRunSourceKind,
  isEvaluationDashboardRefreshActive,
  isStartEvaluationDisabled,
} from "./SettingsEvaluations";

describe("SettingsEvaluations target selection", () => {
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
    ).toBe("legacy");
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

  it("disables starts only while submitting or without a model", () => {
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "moonshotai.kimi-k2.5",
      }),
    ).toBe(false);
    expect(
      isStartEvaluationDisabled({
        submitting: true,
        selectedModel: "moonshotai.kimi-k2.5",
      }),
    ).toBe(true);
    expect(
      isStartEvaluationDisabled({
        submitting: false,
        selectedModel: "",
      }),
    ).toBe(true);
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

describe("buildStartEvalRunInput (U11 dataset launches)", () => {
  it("sends datasetSlug and drops categories entirely (mutually exclusive)", () => {
    expect(
      buildStartEvalRunInput({
        model: "moonshotai.kimi-k2.5",
        categories: ["red-team-data-boundary"],
        datasetSlug: "thinkwork-redteam-baseline",
      }),
    ).toEqual({
      model: "moonshotai.kimi-k2.5",
      datasetSlug: "thinkwork-redteam-baseline",
    });
  });

  it("sends categories (null = all) when no dataset is picked", () => {
    expect(
      buildStartEvalRunInput({
        model: "moonshotai.kimi-k2.5",
        categories: ["red-team-data-boundary"],
        datasetSlug: null,
      }),
    ).toEqual({
      model: "moonshotai.kimi-k2.5",
      categories: ["red-team-data-boundary"],
    });

    expect(
      buildStartEvalRunInput({
        model: "moonshotai.kimi-k2.5",
        categories: [],
        datasetSlug: null,
      }),
    ).toEqual({ model: "moonshotai.kimi-k2.5", categories: null });
  });
});
