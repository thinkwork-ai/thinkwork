import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkItemSavedViews } from "./WorkItemSavedViews";

afterEach(cleanup);

describe("WorkItemSavedViews", () => {
  it("keeps the dialog open when saving fails", async () => {
    const onSaveView = vi.fn().mockResolvedValue(false);

    renderSavedViews({ onSaveView });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Blocked onboarding" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    await waitFor(() =>
      expect(onSaveView).toHaveBeenCalledWith("Blocked onboarding"),
    );
    expect(screen.getByRole("dialog")).toBeTruthy();
  });

  it("closes the dialog after a successful save", async () => {
    const onSaveView = vi.fn().mockResolvedValue(true);

    renderSavedViews({ onSaveView });

    fireEvent.click(screen.getByRole("button", { name: "Save" }));
    fireEvent.change(screen.getByLabelText("Name"), {
      target: { value: "Due soon" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save view" }));

    await waitFor(() => expect(screen.queryByRole("dialog")).toBeNull());
  });
});

function renderSavedViews({
  onSaveView = vi.fn(),
}: {
  onSaveView?: (name: string) => Promise<boolean | void> | boolean | void;
}) {
  return render(
    <WorkItemSavedViews
      views={[]}
      onSelectView={vi.fn()}
      onSaveView={onSaveView}
      onDeleteView={vi.fn()}
    />,
  );
}
