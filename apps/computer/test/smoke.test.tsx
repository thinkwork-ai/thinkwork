import { describe, expect, it } from "vitest";
import { render } from "@testing-library/react";
import { PlaceholderPage } from "../src/components/PlaceholderPage";

describe("apps/computer scaffold smoke", () => {
  it("renders a PlaceholderPage with the supplied title", () => {
    const { getByRole } = render(<PlaceholderPage title="Test Surface" />);
    expect(getByRole("heading", { level: 1 }).textContent).toBe("Test Surface");
  });

  it("renders the default subtitle when none is supplied", () => {
    const { container } = render(<PlaceholderPage title="Computer" />);
    expect(container.textContent).toContain("next phase");
  });
});
