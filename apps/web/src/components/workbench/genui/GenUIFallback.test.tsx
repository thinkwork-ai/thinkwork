import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { GenUIFallback } from "./GenUIFallback";

describe("GenUIFallback", () => {
  it("renders a compact diagnostic fallback", () => {
    render(
      <GenUIFallback
        component="unknown.card"
        diagnostics={[
          {
            code: "GENUI_COMPONENT_UNSUPPORTED",
            message: "Unsupported Thread GenUI component unknown.card.",
            severity: "error",
          },
        ]}
        fallback={{
          title: "Cannot show approval",
          summary: "Open the Thread on web after the card is regenerated.",
          lines: ["Component: unknown.card"],
        }}
      />,
    );

    expect(screen.getByTestId("genui-fallback")).toBeTruthy();
    expect(screen.getByText("Cannot show approval")).toBeTruthy();
    expect(screen.getByText("unknown.card")).toBeTruthy();
    expect(screen.getByText("Component: unknown.card")).toBeTruthy();
  });
});
