import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerComposer } from "./ComputerComposer";

afterEach(cleanup);

describe("ComputerComposer", () => {
  it("disables submit for empty prompts", () => {
    render(
      <ComputerComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );

    const submit = screen.getByRole("button", {
      name: /start/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("submits a non-empty prompt", () => {
    const onSubmit = vi.fn();
    render(
      <ComputerComposer
        value="Build a CRM dashboard"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
