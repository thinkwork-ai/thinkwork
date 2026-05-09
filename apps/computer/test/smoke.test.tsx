import { describe, expect, it, vi } from "vitest";
import { render } from "@testing-library/react";
import { PlaceholderPage } from "../src/components/PlaceholderPage";

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

describe("apps/computer scaffold smoke", () => {
  it("renders the supplied subtitle", () => {
    const { container } = render(
      <PlaceholderPage title="Test Surface" subtitle="Custom subtitle text" />,
    );
    expect(container.textContent).toContain("Custom subtitle text");
  });

  it("renders the default subtitle when none is supplied", () => {
    const { container } = render(<PlaceholderPage title="Computer" />);
    expect(container.textContent).toContain("next phase");
  });
});
