import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ReactNode } from "react";

// Render markdown as plain text — the dark-readability of the real <Response>
// is a styling concern verified elsewhere; here we assert the answer content.
vi.mock("@/components/ai-elements/response", () => ({
  Response: ({ children }: { children: ReactNode }) => (
    <div data-testid="answer">{children}</div>
  ),
}));

vi.mock("@/lib/utils", () => ({
  cn: (...values: unknown[]) => values.filter(Boolean).join(" "),
}));

import {
  SearchAskView,
  humanizeAskStep,
  type SearchAskViewModel,
} from "./SearchAskView";

function view(overrides: Partial<SearchAskViewModel>): SearchAskViewModel {
  return {
    query: "acme renewal",
    status: "running",
    activity: [],
    answer: null,
    error: null,
    threadId: "thread-hidden",
    ...overrides,
  };
}

function renderView(
  model: SearchAskViewModel,
  props?: { sourcesSlot?: ReactNode },
) {
  const onBack = vi.fn();
  const onOpenPermalink = vi.fn();
  const utils = render(
    <SearchAskView
      view={model}
      onBack={onBack}
      onOpenPermalink={onOpenPermalink}
      sourcesSlot={props?.sourcesSlot}
    />,
  );
  return { ...utils, onBack, onOpenPermalink };
}

describe("SearchAskView", () => {
  afterEach(cleanup);

  it("shows an Asking… spinner while dispatching", () => {
    renderView(view({ status: "dispatching" }));
    expect(screen.getByText("Asking…")).toBeTruthy();
    expect(screen.getByRole("status")).toBeTruthy();
  });

  it("renders humanized activity lines while running", () => {
    renderView(
      view({
        status: "running",
        activity: ["Searching the web", "Reading memory"],
      }),
    );
    expect(screen.getByText("Searching the web")).toBeTruthy();
    expect(screen.getByText("Reading memory")).toBeTruthy();
  });

  it("falls back to Thinking… when running with no activity yet", () => {
    renderView(view({ status: "running", activity: [] }));
    expect(screen.getByText("Thinking…")).toBeTruthy();
  });

  it("renders the answer and a permalink when answered", () => {
    const { onOpenPermalink } = renderView(
      view({ status: "answered", answer: "The renewal closes Friday." }),
    );
    expect(screen.getByTestId("answer").textContent).toContain(
      "The renewal closes Friday.",
    );
    const permalink = screen.getByRole("button", { name: /open in thread/i });
    fireEvent.click(permalink);
    expect(onOpenPermalink).toHaveBeenCalled();
  });

  it("renders a sourcesSlot when provided and nothing when absent", () => {
    const { rerender } = renderView(
      view({ status: "answered", answer: "Answer." }),
      { sourcesSlot: <div>Citations here</div> },
    );
    expect(screen.getByText("Citations here")).toBeTruthy();

    rerender(
      <SearchAskView
        view={view({ status: "answered", answer: "Answer." })}
        onBack={vi.fn()}
        onOpenPermalink={vi.fn()}
      />,
    );
    expect(screen.queryByText("Citations here")).toBeNull();
  });

  it("shows the budget rejection message in the error state", () => {
    renderView(
      view({
        status: "error",
        error: "You've reached your usage budget for now.",
      }),
    );
    const alert = screen.getByRole("alert");
    expect(alert.textContent).toContain(
      "You've reached your usage budget for now.",
    );
  });

  it("shows the empty-answer error text", () => {
    renderView(
      view({
        status: "error",
        error: "The answer came back empty — try rephrasing.",
      }),
    );
    expect(
      screen.getByText("The answer came back empty — try rephrasing."),
    ).toBeTruthy();
  });

  it("Back to search invokes onBack", () => {
    const { onBack } = renderView(view({ status: "running" }));
    fireEvent.click(screen.getByRole("button", { name: /back to search/i }));
    expect(onBack).toHaveBeenCalled();
  });
});

describe("humanizeAskStep", () => {
  it("maps tool invocations to readable labels", () => {
    expect(
      humanizeAskStep("tool_invocation_started", { tool_name: "web_search" }),
    ).toBe("Searching the web");
    expect(
      humanizeAskStep("tool_invocation_completed", {
        tool_name: "recall_memory",
      }),
    ).toBe("Reading memory");
    expect(
      humanizeAskStep("tool_invocation_started", { tool_name: "wiki_lookup" }),
    ).toBe("Checking knowledge");
  });

  it("ignores non-tool events", () => {
    expect(humanizeAskStep("completed", { response_length: 10 })).toBeNull();
    expect(humanizeAskStep("error", { message: "boom" })).toBeNull();
  });
});
