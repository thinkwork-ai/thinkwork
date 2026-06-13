import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { EvalResultOverrideControl } from "./SettingsEvalRunDetail";

afterEach(cleanup);

const scoredFail = {
  status: "fail",
  overrideStatus: null,
  overriddenBy: null,
  overriddenAt: null,
  overrideReason: null,
};

describe("EvalResultOverrideControl (U9)", () => {
  it("is operator-gated: renders nothing for non-operators", () => {
    const { container } = render(
      <EvalResultOverrideControl
        result={scoredFail}
        isOperator={false}
        onSubmit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("renders nothing for unscored results (error rows have no verdict to overturn)", () => {
    const { container } = render(
      <EvalResultOverrideControl
        result={{ ...scoredFail, status: "error" }}
        isOperator
        onSubmit={vi.fn()}
      />,
    );
    expect(container.innerHTML).toBe("");
  });

  it("requires a non-empty reason before either override button enables", () => {
    const onSubmit = vi.fn();
    render(
      <EvalResultOverrideControl
        result={scoredFail}
        isOperator
        onSubmit={onSubmit}
      />,
    );

    const markPass = screen.getByRole("button", {
      name: "Mark pass",
    }) as HTMLButtonElement;
    const markFail = screen.getByRole("button", {
      name: "Mark fail",
    }) as HTMLButtonElement;
    expect(markPass.disabled).toBe(true);
    expect(markFail.disabled).toBe(true);

    // Whitespace-only reasons stay rejected.
    fireEvent.change(screen.getByLabelText("Override reason"), {
      target: { value: "   " },
    });
    expect(markPass.disabled).toBe(true);

    fireEvent.change(screen.getByLabelText("Override reason"), {
      target: { value: "Judge misread the refusal" },
    });
    expect(markPass.disabled).toBe(false);

    fireEvent.click(markPass);
    expect(onSubmit).toHaveBeenCalledWith("pass", "Judge misread the refusal");
  });

  it("shows the current override (who/when/why) with the original judge verdict preserved, and clears", () => {
    const onSubmit = vi.fn();
    render(
      <EvalResultOverrideControl
        result={{
          status: "fail",
          overrideStatus: "pass",
          overriddenBy: "user-admin-1",
          overriddenAt: "2026-06-12T01:00:00Z",
          overrideReason: "Judge misread the refusal",
        }}
        isOperator
        onSubmit={onSubmit}
      />,
    );

    // Original judge verdict stays visible beside the override.
    expect(screen.getByText(/original judge verdict/i)).toBeTruthy();
    expect(screen.getByText(/user-admin-1/)).toBeTruthy();
    expect(screen.getByText(/Reason: Judge misread the refusal/)).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Clear override" }));
    expect(onSubmit).toHaveBeenCalledWith(null, "");
  });

  it("offers no clear action when no override exists", () => {
    render(
      <EvalResultOverrideControl
        result={scoredFail}
        isOperator
        onSubmit={vi.fn()}
      />,
    );
    expect(screen.queryByRole("button", { name: "Clear override" })).toBeNull();
  });
});
