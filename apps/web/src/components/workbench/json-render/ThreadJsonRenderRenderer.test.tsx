import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import {
  createPrimitiveJsonRenderFixture,
  createTaskReviewJsonRenderFixture,
} from "./fixtures";
import { ThreadJsonRenderFallback } from "./ThreadJsonRenderFallback";
import { ThreadJsonRenderRenderer } from "./ThreadJsonRenderRenderer";

describe("ThreadJsonRenderRenderer", () => {
  it("renders nested upstream shadcn primitive specs through json-render", () => {
    const fixture = createPrimitiveJsonRenderFixture();

    render(
      <ThreadJsonRenderRenderer data={fixture.data} partId={fixture.id} />,
    );

    expect(screen.getByText("Pipeline health")).toBeTruthy();
    expect(screen.getByText("All checks are ready.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("renders ThinkWork domain entries through json-render registry adapters", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    render(<ThreadJsonRenderRenderer data={fixture.data} />);

    expect(screen.getByTestId("genui-task-review")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
  });

  it("fails closed to compact fallback for invalid data", () => {
    render(<ThreadJsonRenderRenderer data={null} />);

    expect(screen.getByTestId("json-render-fallback")).toBeTruthy();
    expect(screen.getByText("Generated UI unavailable")).toBeTruthy();
  });

  it("renders the legacy generated UI fallback state", () => {
    render(
      <ThreadJsonRenderFallback
        component="task.review"
        fallback={{
          title: "Legacy task review",
          summary: "Old generated UI shape.",
        }}
        legacy
      />,
    );

    expect(screen.getByTestId("json-render-legacy-fallback")).toBeTruthy();
    expect(screen.getByText("Legacy generated UI unsupported")).toBeTruthy();
    expect(screen.getByText("task.review")).toBeTruthy();
  });
});
