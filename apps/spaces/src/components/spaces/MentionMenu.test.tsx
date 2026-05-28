import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  filterMentionTargets,
  MentionMenu,
  type MentionTarget,
} from "./MentionMenu";

afterEach(cleanup);

const targets: MentionTarget[] = [
  {
    id: "agent:a1",
    targetType: "AGENT",
    targetId: "a1",
    displayName: "Coordinator",
    aliases: ["agent", "think"],
    isDefaultAgent: true,
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

  it("opens upward by default and downward when placement is bottom", () => {
    const { rerender } = render(
      <MentionMenu targets={targets} query="" onSelect={vi.fn()} />,
    );
    const upward = screen.getByRole("listbox").className;
    expect(upward).toContain("bottom-full");
    expect(upward).not.toContain("top-full");
    expect(upward).toContain("max-h-[40vh]");
    expect(upward).toContain("overflow-y-auto");

    rerender(
      <MentionMenu
        targets={targets}
        query=""
        placement="bottom"
        onSelect={vi.fn()}
      />,
    );
    const downward = screen.getByRole("listbox").className;
    expect(downward).toContain("top-full");
    expect(downward).not.toContain("bottom-full");
  });

  it("pins the default agent shortcut first only when explicitly enabled", () => {
    expect(filterMentionTargets(targets, "")[0]?.displayName).toBe(
      "Coordinator",
    );

    const filtered = filterMentionTargets(targets, "", {
      includeDefaultAgentShortcut: true,
    });

    expect(filtered[0]).toMatchObject({
      targetType: "AGENT",
      targetId: "a1",
      displayName: "agent",
      isDefaultAgent: true,
    });
    expect(filtered[1]?.displayName).toBe("Alex Finance");
  });

  it("shows the default agent shortcut for alias prefixes and hides it for unrelated queries", () => {
    expect(
      filterMentionTargets(targets, "th", {
        includeDefaultAgentShortcut: true,
      })[0]?.displayName,
    ).toBe("agent");

    expect(
      filterMentionTargets(targets, "finance", {
        includeDefaultAgentShortcut: true,
      }).some((target) => target.displayName === "agent"),
    ).toBe(false);
  });

  it("selects the synthetic default agent shortcut", () => {
    const onSelect = vi.fn();
    render(
      <MentionMenu
        targets={targets}
        query="ag"
        includeDefaultAgentShortcut
        onSelect={onSelect}
      />,
    );

    const options = screen.getAllByRole("option");
    expect(options[0]?.textContent).toContain("agent");

    fireEvent.click(options[0]!);
    expect(onSelect).toHaveBeenCalledWith(
      expect.objectContaining({
        targetType: "AGENT",
        targetId: "a1",
        displayName: "agent",
        isDefaultAgent: true,
      }),
    );
  });
});
