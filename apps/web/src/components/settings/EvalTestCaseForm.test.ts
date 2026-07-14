import { describe, expect, it, vi } from "vitest";
import {
  completeEvalTestCaseFormDelete,
  completeEvalTestCaseFormSubmit,
} from "./EvalTestCaseForm";

describe("completeEvalTestCaseFormSubmit", () => {
  it("uses the embedded completion callback instead of navigating", () => {
    const onSaved = vi.fn();
    const navigateToStudio = vi.fn();

    completeEvalTestCaseFormSubmit({ onSaved, navigateToStudio });

    expect(onSaved).toHaveBeenCalledTimes(1);
    expect(navigateToStudio).not.toHaveBeenCalled();
  });

  it("falls back to Studio navigation for full-page forms", () => {
    const navigateToStudio = vi.fn();

    completeEvalTestCaseFormSubmit({ navigateToStudio });

    expect(navigateToStudio).toHaveBeenCalledTimes(1);
  });
});

describe("completeEvalTestCaseFormDelete", () => {
  it("uses the embedded onDeleted callback instead of navigating (sheet embedding)", () => {
    const onDeleted = vi.fn();
    const navigateToStudio = vi.fn();

    completeEvalTestCaseFormDelete({ onDeleted, navigateToStudio });

    expect(onDeleted).toHaveBeenCalledTimes(1);
    expect(navigateToStudio).not.toHaveBeenCalled();
  });

  it("falls back to Studio navigation for the full-page edit route (R5)", () => {
    const navigateToStudio = vi.fn();

    completeEvalTestCaseFormDelete({ navigateToStudio });

    expect(navigateToStudio).toHaveBeenCalledTimes(1);
  });
});
