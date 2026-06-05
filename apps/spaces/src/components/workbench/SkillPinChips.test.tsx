import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SkillPinChips } from "./SkillPinChips";

afterEach(cleanup);

describe("SkillPinChips", () => {
  it("renders a chip per pin with its display name", () => {
    render(
      <SkillPinChips
        pins={[
          { slug: "crm-dashboard", displayName: "CRM Dashboard" },
          { slug: "invoice-parser", displayName: "Invoice Parser" },
        ]}
        onRemove={() => {}}
      />,
    );
    expect(screen.getByText("CRM Dashboard")).toBeTruthy();
    expect(screen.getByText("Invoice Parser")).toBeTruthy();
  });

  it("fires onRemove with the slug when the X is clicked", () => {
    const onRemove = vi.fn();
    render(
      <SkillPinChips
        pins={[{ slug: "crm-dashboard", displayName: "CRM Dashboard" }]}
        onRemove={onRemove}
      />,
    );
    fireEvent.click(screen.getByLabelText("Remove CRM Dashboard skill"));
    expect(onRemove).toHaveBeenCalledWith("crm-dashboard");
  });

  it("renders nothing when there are no pins", () => {
    const { container } = render(
      <SkillPinChips pins={[]} onRemove={() => {}} />,
    );
    expect(container.firstChild).toBeNull();
  });
});
