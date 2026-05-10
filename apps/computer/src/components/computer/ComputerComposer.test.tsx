import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
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

  it("submits a non-empty prompt", async () => {
    // Plan-012 U13: PromptInput's form submit goes through an async
    // Promise.all chain (file blob → data URL conversion before
    // dispatch), so the spy fires after a microtask. Use waitFor.
    const onSubmit = vi.fn();
    render(
      <ComputerComposer
        value="Build a CRM dashboard"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });
});
