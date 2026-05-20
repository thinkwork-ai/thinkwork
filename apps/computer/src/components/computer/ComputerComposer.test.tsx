import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ComputerComposer } from "./ComputerComposer";
import { useState } from "react";
import type { MentionTarget } from "@/components/spaces/MentionMenu";

afterEach(cleanup);

const mentionTargets: MentionTarget[] = [
  {
    id: "user:u1",
    targetType: "USER",
    targetId: "u1",
    displayName: "Eric Odom",
    role: "requester",
  },
  {
    id: "agent:a1",
    targetType: "AGENT",
    targetId: "a1",
    displayName: "Marco",
    role: "agent",
  },
];

describe("ComputerComposer focus styling", () => {
  // Plan U2: the empty-thread composer must not show a darker "well" or
  // ring when its textarea is focused. We assert on the className the
  // component passes to PromptInput so the override classes don't drift.
  it("omits the dark:bg-input/30 wrapper background", () => {
    const { container } = render(
      <ComputerComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const cls = form?.className ?? "";
    expect(cls).not.toContain("bg-background/40");
    expect(cls).not.toContain("dark:bg-input/30");
  });

  it("neutralizes the InputGroup focus ring and border flip", () => {
    const { container } = render(
      <ComputerComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );
    const cls = container.querySelector("form")?.className ?? "";
    expect(cls).toContain(
      "has-[[data-slot=input-group-control]:focus-visible]:ring-0",
    );
    expect(cls).toContain(
      "has-[[data-slot=input-group-control]:focus-visible]:border-border/80",
    );
  });
});

describe("ComputerComposer", () => {
  it("disables submit for empty prompts", () => {
    render(
      <ComputerComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );

    const submit = screen.getByRole("button", {
      name: /start/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("submits a non-empty prompt", async () => {
    // Plan-012 U13: PromptInput's form submit goes through an async
    // Promise.all chain (file blob → data URL conversion before
    // dispatch), so the spy fires after a microtask. Use waitFor.
    const onSubmit = vi.fn();
    render(
      <ComputerComposer
        value="Build a CRM dashboard"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it("shows mention suggestions and inserts the selected target", () => {
    render(<ControlledComposer />);

    fireEvent.change(screen.getByLabelText("Ask your Computer"), {
      target: { value: "@mar" },
    });

    expect(screen.getByRole("option", { name: /Marco/ })).toBeTruthy();
    expect(screen.queryByText("@Marco")).toBeNull();
    expect(screen.queryByText("agent")).toBeNull();

    fireEvent.keyDown(screen.getByLabelText("Ask your Computer"), {
      key: "Enter",
    });

    expect(
      (screen.getByLabelText("Ask your Computer") as HTMLTextAreaElement).value,
    ).toBe("@Marco ");
  });
});

function ControlledComposer() {
  const [value, setValue] = useState("");
  return (
    <ComputerComposer
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      mentionTargets={mentionTargets}
    />
  );
}
