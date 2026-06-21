/**
 * Tests for renderTypedPart (plan-012 U14).
 *
 * Pin the part-type → AI Elements primitive mapping. Snapshot-style
 * structural assertions only — we don't assert visual output, just
 * that each part type renders the expected primitive.
 */

import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { createAnalyticsDisplayFixture } from "@thinkwork/analytics-display";
import {
  createAnalyticsDisplayGenUIPart,
  createTaskReviewGenUIFixture,
} from "@thinkwork/genui";
import type { AccumulatedPart } from "@/lib/ui-message-merge";

vi.mock("@/applets/mount", () => ({
  AppletFailure: ({ children }: { children: ReactNode }) => (
    <div data-testid="applet-failure">{children}</div>
  ),
  AppletMount: ({ appId }: { appId: string }) => (
    <div data-app-id={appId} data-testid="draft-applet-mount" />
  ),
  useAppletInstanceId: (appId: string) => `instance-${appId}`,
}));

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, vi.fn()],
}));

import { renderTypedPart, renderTypedParts } from "./render-typed-part";

afterEach(cleanup);

function rk() {
  return { keyPrefix: "msg-1", index: 0 };
}

describe("renderTypedPart", () => {
  it("renders a text part via <Response>", () => {
    const part: AccumulatedPart = {
      type: "text",
      id: "p1",
      text: "Hello",
      state: "done",
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    // <Response> renders to a <div class="ai-response prose ...">
    const proseHost = container.querySelector("div.ai-response");
    expect(proseHost).not.toBeNull();
  });

  it("renders a reasoning part via <Reasoning> + <ReasoningContent>", () => {
    const part: AccumulatedPart = {
      type: "reasoning",
      id: "r1",
      text: "Hmm",
      state: "streaming",
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    // Reasoning wraps a Collapsible; structural smoke check.
    expect(
      container.querySelector(
        '[data-slot="collapsible"], [class*=collapsible], [class*=not-prose]',
      ),
    ).not.toBeNull();
  });

  it("renders a tool-${name} part via <Tool>", () => {
    const part: AccumulatedPart = {
      type: "tool-renderFragment",
      toolCallId: "t1",
      toolName: "renderFragment",
      input: { tsx: "<App />" },
      output: { rendered: true },
      state: "output-available",
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    // Tool renders some structural elements; we just assert the
    // container has children and didn't throw.
    expect(container.firstChild).not.toBeNull();
  });

  it("renders draft app preview tool output through the sandbox preview component", () => {
    const part: AccumulatedPart = {
      type: "tool-preview_app",
      toolCallId: "draft-1",
      toolName: "preview_app",
      output: {
        type: "draft_app_preview",
        draft: {
          draftId: "draft_123",
          unsaved: true,
          name: "CRM Draft",
          files: {
            "App.tsx": "export default function App() { return null; }",
          },
          validation: { ok: true, status: "passed", errors: [] },
        },
      },
      state: "output-available",
    };

    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByTestId("draft-applet-preview")).toBeTruthy();
    expect(screen.getByTestId("draft-applet-mount")).toBeTruthy();
    expect(screen.queryByLabelText("Tool activity")).toBeNull();
  });

  it("groups tool parts into one collapsed tool activity section", () => {
    const parts: AccumulatedPart[] = [
      {
        type: "text",
        id: "p1",
        text: "Working",
        state: "done",
      },
      {
        type: "tool-web_search",
        toolCallId: "t1",
        toolName: "web_search",
        input: { preview: "{}" },
        state: "input-available",
      },
      {
        type: "tool-browser_automation",
        toolCallId: "t2",
        toolName: "browser_automation",
        state: "input-available",
      },
    ];

    const { container } = render(
      <>{renderTypedParts(parts, { keyPrefix: "msg-1" })}</>,
    );

    expect(screen.getByLabelText("Tool activity")).toBeTruthy();
    expect(screen.getByText(/2 tool calls/)).toBeTruthy();
    expect(container.textContent).not.toContain("PARAMETERS");
  });

  it("does not render runbook queue parts in the transcript renderer", () => {
    const part: AccumulatedPart = {
      type: "data-runbook-queue",
      id: "runbook-queue:run-1",
      data: {
        runbookRunId: "run-1",
        displayName: "CRM Dashboard",
        status: "RUNNING",
        phases: [
          {
            id: "discover",
            title: "Discover",
            tasks: [
              {
                id: "task-1",
                title: "Discover CRM context",
                status: "PENDING",
              },
            ],
          },
        ],
      },
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    expect(container.textContent).toBe("");
  });

  it("routes analytics data-genui parts to the inline analytics renderer", () => {
    const part = createAnalyticsDisplayGenUIPart({
      id: "genui:analytics:support-volume",
      payload: createAnalyticsDisplayFixture(),
    }) as AccumulatedPart;

    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByTestId("analytics-display-part")).toBeTruthy();
    expect(screen.getByText("Support Volume")).toBeTruthy();
  });

  it("routes native data-genui parts to the Thread GenUI renderer", () => {
    const part = createTaskReviewGenUIFixture() as AccumulatedPart;

    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByTestId("genui-task-review")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
  });

  it("renders invalid data-genui parts as compact fallbacks", () => {
    const part: AccumulatedPart = {
      type: "data-genui",
      id: "genui:bad",
      data: {
        schemaVersion: "thread-genui/v1",
        catalogVersion: "thread-genui-catalog/v1",
        status: "ready",
        spec: {
          root: "bad",
          elements: {
            bad: {
              component: "unknown.panel",
              props: { title: "Unsupported" },
            },
          },
        },
        mobileFallback: {
          title: "Unsupported generated UI",
          summary: "This panel is not in the catalog.",
        },
      },
    };

    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByTestId("genui-fallback")).toBeTruthy();
    expect(screen.getByText("unknown.panel")).toBeTruthy();
  });

  it("renders goal-run data parts with compact status evidence", () => {
    const part: AccumulatedPart = {
      type: "data-goal-run",
      id: "goal-run-1",
      data: {
        source: "pi_goal",
        status: "complete",
        objective: "Prepare launch report",
        completion_summary: "Launch report is complete.",
        tokens_used: 28000,
        token_budget: 125000,
      },
    };

    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByText("Goal")).toBeTruthy();
    expect(screen.getByText("Completed")).toBeTruthy();
    expect(screen.getByText("Prepare launch report")).toBeTruthy();
    expect(screen.getByText("Launch report is complete.")).toBeTruthy();
    expect(screen.getByText("Tokens: 28.0K / 125.0K")).toBeTruthy();
  });

  it("renders a source-url part as an anchor", () => {
    const part: AccumulatedPart = {
      type: "source-url",
      sourceId: "s1",
      url: "https://example.com",
      title: "Example",
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("https://example.com");
    expect(anchor!.textContent).toBe("Example");
  });

  it("renders a file part as an anchor with media-type label", () => {
    const part: AccumulatedPart = {
      type: "file",
      url: "https://example.com/x.png",
      mediaType: "image/png",
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    const anchor = container.querySelector("a");
    expect(anchor).not.toBeNull();
    expect(anchor!.getAttribute("href")).toBe("https://example.com/x.png");
  });

  it("routes data-user-question parts to the UserQuestionCard", () => {
    const part: AccumulatedPart = {
      type: "data-user-question",
      id: "user-question:q-1",
      data: {
        questionId: "q-1",
        questions: [
          {
            question: "Which environment should this target?",
            header: "Env",
            options: [
              { label: "Staging (Recommended)", description: "Safe default." },
              { label: "Production", description: "Live traffic." },
            ],
          },
        ],
      },
    };
    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByTestId("user-question-card")).toBeTruthy();
    expect(screen.getByText("Env")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /submit answers/i }),
    ).toBeTruthy();
    // Not the forward-compat debug strip.
    expect(screen.queryByText("data-user-question")).toBeNull();
  });

  it("routes flat persisted data-user-question parts (intake write shape, no nested data)", () => {
    // Regression: the intake endpoint persists {type, questionId, questions}
    // flat on the part — no `data` envelope. The renderer must accept both.
    const part = {
      type: "data-user-question",
      id: "user-question:q-2",
      questionId: "q-2",
      questions: [
        {
          question: "Which day works best?",
          header: "Timing",
          options: [
            { label: "Monday (Recommended)", description: "Start of week." },
            { label: "Friday", description: "End of week." },
          ],
        },
      ],
    } as unknown as AccumulatedPart;
    render(<>{renderTypedPart(part, rk())}</>);

    expect(screen.getByTestId("user-question-card")).toBeTruthy();
    expect(screen.getByText("Timing")).toBeTruthy();
    expect(screen.getByText(/Monday/)).toBeTruthy();
    expect(
      screen.getByRole("button", { name: /submit answers/i }),
    ).toBeTruthy();
  });

  it("renders the answered question card from the message-level record", () => {
    const part: AccumulatedPart = {
      type: "data-user-question",
      id: "user-question:q-1",
      data: {
        questionId: "q-1",
        questions: [
          {
            question: "Which environment should this target?",
            header: "Env",
            options: [
              { label: "Staging", description: "" },
              { label: "Production", description: "" },
            ],
          },
        ],
      },
    };
    render(
      <>
        {renderTypedPart(part, {
          ...rk(),
          userQuestion: {
            id: "q-1",
            status: "ANSWERED",
            answers: JSON.stringify({ Env: "Production" }),
            answeredVia: "CARD",
            answeredBy: "user-1",
            answeredAt: "2026-06-09T12:00:00Z",
          },
        })}
      </>,
    );

    expect(screen.getByTestId("user-question-card")).toBeTruthy();
    expect(screen.getByText("Production")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /submit/i })).toBeNull();
  });

  it("renders an unknown data-${name} part as a forward-compat debug strip", () => {
    const part: AccumulatedPart = {
      type: "data-future-shape",
      data: { foo: "bar" },
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    expect(container.textContent).toContain("data-future-shape");
  });

  it("renders nothing surprising for an unsupported part type (defensive return null)", () => {
    // A theoretical unknown part shape should not crash — the helper
    // returns null and React renders nothing.
    const part = {
      type: "source-document" as const,
      sourceId: "s1",
      mediaType: "text/markdown",
      title: "doc",
    };
    const { container } = render(<>{renderTypedPart(part, rk())}</>);
    expect(container.textContent).toContain("doc");
  });
});
