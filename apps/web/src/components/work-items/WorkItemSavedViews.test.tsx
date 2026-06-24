import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { WorkItemSavedViews } from "./WorkItemSavedViews";

afterEach(cleanup);

describe("WorkItemSavedViews", () => {
  it("shows the saved-view header icon without a save button", () => {
    render(
      <WorkItemSavedViews
        views={[]}
        onSelectView={vi.fn()}
        onDeleteView={vi.fn()}
      />,
    );

    expect(
      screen.getByRole("button", { name: "Work Item views" }),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: "Save" })).toBeNull();
  });
});
