import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { SpacesComposer } from "./SpacesComposer";
import { useState } from "react";
import type { MentionTarget } from "@/components/spaces/MentionMenu";
import { SPACES_COMPOSER_FOCUS_EVENT } from "@/lib/composer-focus";

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
  delete window.thinkworkBridge;
});

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

describe("SpacesComposer focus styling", () => {
  // Plan U2: the empty-thread composer must not show a darker "well" or
  // ring when its textarea is focused. We assert on the className the
  // component passes to PromptInput so the override classes don't drift.
  it("omits the dark:bg-input/30 wrapper background", () => {
    const { container } = render(
      <SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );
    const form = container.querySelector("form");
    expect(form).toBeTruthy();
    const cls = form?.className ?? "";
    expect(cls).not.toContain("bg-background/40");
    expect(cls).not.toContain("dark:bg-input/30");
  });

  it("neutralizes the InputGroup focus ring and border flip", () => {
    const { container } = render(
      <SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );
    const cls = container.querySelector("form")?.className ?? "";
    expect(cls).toContain("[&_[data-slot=input-group]]:!ring-0");
    expect(cls).toContain("[&_[data-slot=input-group]]:!bg-[#262626]");
  });
});

describe("SpacesComposer", () => {
  it("renders a tabler planet glyph for the space picker", () => {
    const { container } = renderComposerWithSpaces();

    expect(container.querySelector(".tabler-icon-planet")).toBeTruthy();
    expect(container.querySelector(".lucide-folder")).toBeNull();
  });

  it("keeps the space picker muted for the default space", () => {
    const { container } = renderComposerWithSpaces({
      selectedSpaceIsDefault: true,
    });

    const trigger = screen.getByLabelText("Select Space");
    expect(classTokens(trigger)).toContain("text-muted-foreground");
    expect(classTokens(trigger)).not.toContain("text-foreground");
    expect(trigger.getAttribute("title")).toBe("Choose a Space");
    expect(
      container.querySelector(".tabler-icon-planet")?.getAttribute("class"),
    ).toContain("text-muted-foreground");
  });

  it("promotes only the space picker when a non-default space is selected", () => {
    const { container } = renderComposerWithSpaces({
      selectedSpaceId: "space-analysis",
      selectedSpaceIsDefault: false,
    });

    const trigger = screen.getByLabelText("Select Space");
    expect(classTokens(trigger)).toContain("text-foreground");
    expect(classTokens(trigger)).toContain("hover:text-foreground/80");
    expect(classTokens(trigger)).not.toContain("text-muted-foreground");
    expect(
      container.querySelector(".tabler-icon-planet")?.getAttribute("class"),
    ).toContain("text-foreground");
    expect(
      screen.getByRole("button", { name: "Attach file" }).className,
    ).toContain("text-muted-foreground");
  });

  it("does not render the space picker without selectable spaces", () => {
    render(
      <SpacesComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        spaces={[]}
      />,
    );

    expect(screen.queryByLabelText("Select Space")).toBeNull();
  });

  it("focuses the input when it mounts", async () => {
    render(<SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />);

    const input = screen.getByLabelText("Send message");
    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("focuses the input once the disabled flag flips to enabled", async () => {
    // Regression: on /new arrival the composer is disabled while
    // spacesFetching / computersFetching is true; autoFocus and the
    // mount-time focusComposerInput() both silently no-op on a disabled
    // input. After the fetches resolve and isSubmitting flips to false,
    // the textarea must take focus without a user click.
    const { rerender } = render(
      <SpacesComposer
        value=""
        onChange={() => {}}
        onSubmit={() => {}}
        isSubmitting
      />,
    );

    const input = screen.getByLabelText("Send message") as HTMLTextAreaElement;
    expect(input.disabled).toBe(true);
    expect(document.activeElement).not.toBe(input);

    rerender(
      <SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />,
    );

    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("refocuses the input when the New thread nav requests focus", async () => {
    render(
      <>
        <button type="button">Other focus target</button>
        <SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />
      </>,
    );

    const other = screen.getByRole("button", { name: /other focus target/i });
    const input = screen.getByLabelText("Send message");
    other.focus();
    expect(document.activeElement).toBe(other);

    window.dispatchEvent(new CustomEvent(SPACES_COMPOSER_FOCUS_EVENT));

    await waitFor(() => expect(document.activeElement).toBe(input));
  });

  it("disables submit for empty prompts", () => {
    render(<SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />);

    const submit = screen.getByRole("button", {
      name: /start/i,
    }) as HTMLButtonElement;
    expect(submit.disabled).toBe(true);
  });

  it("renders voice input next to the start button", () => {
    render(<SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />);

    const voiceInput = screen.getByRole("button", { name: "Voice input" });
    const startButton = screen.getByRole("button", { name: "Start" });
    expect(voiceInput).toBeTruthy();
    expect(startButton.parentElement?.contains(voiceInput)).toBe(true);
  });

  it("does not render a runtime (cloud) toggle — runtime is host-derived", () => {
    vi.stubGlobal("__DESKTOP_BUILD__", true);
    Object.defineProperty(window, "thinkworkBridge", {
      configurable: true,
      value: {},
    });

    render(<SpacesComposer value="" onChange={() => {}} onSubmit={() => {}} />);

    expect(screen.queryByLabelText(/local pi/i)).toBeNull();
  });

  it("submits a non-empty prompt", async () => {
    // Plan-012 U13: PromptInput's form submit goes through an async
    // Promise.all chain (file blob → data URL conversion before
    // dispatch), so the spy fires after a microtask. Use waitFor.
    const onSubmit = vi.fn();
    render(
      <SpacesComposer
        value="Build a CRM dashboard"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
    expect(onSubmit).toHaveBeenCalledWith([], [], true, []);
  });

  it("passes agent opt-out through submit", async () => {
    const onSubmit = vi.fn();
    render(
      <SpacesComposer
        value="Keep this human-only"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Send to agent" }));
    fireEvent.click(screen.getByRole("button", { name: /start/i }));

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledWith([], [], false, []);
    });
  });

  it("forces agent handling on for @agent and @think aliases", () => {
    const { rerender } = render(
      <SpacesComposer
        value="@agent help with this"
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    let agentToggle = screen.getByRole("button", {
      name: "Send to agent",
    }) as HTMLButtonElement;
    expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
    expect(agentToggle.disabled).toBe(true);

    rerender(
      <SpacesComposer
        value="@think help with this"
        onChange={() => {}}
        onSubmit={() => {}}
      />,
    );

    agentToggle = screen.getByRole("button", {
      name: "Send to agent",
    }) as HTMLButtonElement;
    expect(agentToggle.getAttribute("aria-pressed")).toBe("true");
    expect(agentToggle.disabled).toBe(true);
  });

  it("submits a non-empty prompt when Enter is pressed", async () => {
    const onSubmit = vi.fn();
    render(
      <SpacesComposer
        value="Build a CRM dashboard"
        onChange={() => {}}
        onSubmit={onSubmit}
      />,
    );

    fireEvent.keyDown(screen.getByLabelText("Send message"), {
      key: "Enter",
    });

    await waitFor(() => {
      expect(onSubmit).toHaveBeenCalledTimes(1);
    });
  });

  it("shows mention suggestions and inserts the selected target", () => {
    render(<ControlledComposer />);

    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "@mar" },
    });

    expect(screen.getByRole("option", { name: /Marco/ })).toBeTruthy();
    expect(screen.queryByText("@Marco")).toBeNull();
    expect(screen.queryByText("agent")).toBeNull();

    fireEvent.keyDown(screen.getByLabelText("Send message"), {
      key: "Enter",
    });

    expect(
      (screen.getByLabelText("Send message") as HTMLTextAreaElement).value,
    ).toBe("@Marco ");
  });

  it("commits the highlighted mention on Tab", () => {
    render(<ControlledComposer />);

    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "@mar" },
    });
    expect(screen.getByRole("option", { name: /Marco/ })).toBeTruthy();

    const event = fireEvent.keyDown(screen.getByLabelText("Send message"), {
      key: "Tab",
    });

    // Tab is intercepted (returns false = preventDefault was called) and
    // commits the mention rather than moving focus.
    expect(event).toBe(false);
    expect(
      (screen.getByLabelText("Send message") as HTMLTextAreaElement).value,
    ).toBe("@Marco ");
  });

  it("closes the mention menu on Escape without committing", () => {
    render(<ControlledComposer />);

    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "@mar" },
    });
    expect(screen.getByRole("option", { name: /Marco/ })).toBeTruthy();

    fireEvent.keyDown(screen.getByLabelText("Send message"), {
      key: "Escape",
    });

    expect(screen.queryByRole("option", { name: /Marco/ })).toBeNull();
    // Text is unchanged — nothing was committed.
    expect(
      (screen.getByLabelText("Send message") as HTMLTextAreaElement).value,
    ).toBe("@mar");
  });

  it("does not intercept Tab when the mention menu is closed", () => {
    render(<ControlledComposer />);

    const event = fireEvent.keyDown(screen.getByLabelText("Send message"), {
      key: "Tab",
    });

    // No open menu -> Tab is not intercepted (default focus traversal allowed).
    expect(event).toBe(true);
  });

  it("defaults the agent toggle OFF once a user is mentioned", () => {
    render(<ControlledComposer />);

    const toggle = screen.getByRole("button", { name: "Send to agent" });
    // Single-player (no mentions) -> ON.
    expect(toggle.getAttribute("aria-pressed")).toBe("true");

    // Mention a user -> multi-player -> auto-derives OFF.
    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "@eri" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Eric Odom/ }));

    expect(toggle.getAttribute("aria-pressed")).toBe("false");
  });

  it("keeps the agent toggle ON when only an agent is mentioned", () => {
    render(<ControlledComposer />);

    fireEvent.change(screen.getByLabelText("Send message"), {
      target: { value: "@mar" },
    });
    fireEvent.click(screen.getByRole("option", { name: /Marco/ }));

    expect(
      screen
        .getByRole("button", { name: "Send to agent" })
        .getAttribute("aria-pressed"),
    ).toBe("true");
  });
});

function ControlledComposer() {
  const [value, setValue] = useState("");
  return (
    <SpacesComposer
      value={value}
      onChange={setValue}
      onSubmit={() => {}}
      mentionTargets={mentionTargets}
    />
  );
}

function renderComposerWithSpaces({
  selectedSpaceId = "space-default",
  selectedSpaceIsDefault = true,
}: {
  selectedSpaceId?: string;
  selectedSpaceIsDefault?: boolean;
} = {}) {
  return render(
    <SpacesComposer
      value=""
      onChange={() => {}}
      onSubmit={() => {}}
      spaces={[
        { id: "space-default", name: "Default" },
        { id: "space-analysis", name: "Analysis" },
      ]}
      selectedSpaceId={selectedSpaceId}
      selectedSpaceIsDefault={selectedSpaceIsDefault}
      onSelectedSpaceChange={() => {}}
    />,
  );
}

function classTokens(element: Element): string[] {
  return element.className.split(/\s+/).filter(Boolean);
}
