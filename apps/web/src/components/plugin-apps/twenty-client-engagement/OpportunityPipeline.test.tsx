import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

import { OpportunityPipeline } from "./components/OpportunityPipeline";

afterEach(() => {
  cleanup();
});

describe("OpportunityPipeline", () => {
  it("keeps edited pipeline content visible when overlay save fails", async () => {
    const saveOverlay = vi.fn(async () => {
      throw new Error("Overlay unavailable");
    });

    render(
      <OpportunityPipeline
        overlayBySection={new Map()}
        overlayError={null}
        onSaveOverlay={saveOverlay}
      />,
    );

    fireEvent.change(screen.getByLabelText("Pipeline client name"), {
      target: { value: "Unsaved Pipeline Account" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Save use cases" }));

    await waitFor(() =>
      expect(screen.getByText("Overlay unavailable")).toBeTruthy(),
    );
    expect(
      (screen.getByLabelText("Pipeline client name") as HTMLInputElement).value,
    ).toBe("Unsaved Pipeline Account");
    expect(saveOverlay).toHaveBeenCalledWith(
      "use-case-pipeline",
      expect.objectContaining({
        accounts: expect.arrayContaining([
          expect.objectContaining({ client: "Unsaved Pipeline Account" }),
        ]),
      }),
    );
  });
});
