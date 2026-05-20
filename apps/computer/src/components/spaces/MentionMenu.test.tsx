import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MentionMenu, type MentionTarget } from "./MentionMenu";

afterEach(cleanup);

const targets: MentionTarget[] = [
  {
    id: "agent:a1",
    targetType: "AGENT",
    targetId: "a1",
    displayName: "Coordinator",
    role: "coordinator",
  },
  {
    id: "user:u1",
    targetType: "USER",
    targetId: "u1",
    displayName: "Alex Finance",
    role: "finance",
  },
];

describe("MentionMenu", () => {
  it("filters mention targets and returns the selected target", () => {
    const onSelect = vi.fn();
    render(<MentionMenu targets={targets} query="ordin" onSelect={onSelect} />);

    expect(screen.getByText("Coordinator")).toBeTruthy();
    expect(screen.queryByText("coordinator")).toBeNull();
    expect(screen.queryByText("Alex Finance")).toBeNull();

    fireEvent.click(screen.getByRole("option", { name: /Coordinator/ }));
    expect(onSelect).toHaveBeenCalledWith(targets[0]);
  });

  it("highlights the active option with padded interior rows", () => {
    render(
      <MentionMenu
        targets={targets}
        query=""
        activeIndex={1}
        onSelect={vi.fn()}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options[1].getAttribute("aria-selected")).toBe("true");
    expect(options[1].className).toContain("px-2.5");
    expect(screen.getByRole("listbox").className).toContain("p-2");
  });
});
