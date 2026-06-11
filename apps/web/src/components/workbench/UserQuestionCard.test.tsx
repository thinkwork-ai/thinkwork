/**
 * UserQuestionCard tests (plan 2026-06-09-005 U8).
 *
 * Covers AE5 (three-question batch → one card, one submit) plus the
 * one-question-at-a-time tab strip (tabs per question, single-select
 * auto-advance, multiSelect stays put, single-question batches render with
 * no tab chrome) and the answer-payload wire convention: answers keyed by
 * question HEADER, single-select = label string, multiSelect = array of
 * labels, "Other" = the typed text, and " (Recommended)" suffixes submitted
 * verbatim while stripped for display. Answered state always renders from
 * the question RECORD, never local component state — and an answered or
 * cancelled card always shows what was asked (never a contentless shell).
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mutationState: { fetching: boolean } = { fetching: false };
const executeMutation = vi.fn();

vi.mock("urql", () => ({
  useMutation: () => [mutationState, executeMutation],
}));

import { UserQuestionCard, type UserQuestionRecord } from "./UserQuestionCard";
import type { UserQuestionData } from "@/lib/ui-message-types";

afterEach(cleanup);

beforeEach(() => {
  mutationState.fetching = false;
  executeMutation.mockReset();
  executeMutation.mockResolvedValue({
    data: {
      answerUserQuestion: {
        id: "q-1",
        status: "ANSWERED",
        answers: "{}",
        answeredVia: "CARD",
        answeredBy: "user-1",
        answeredAt: new Date().toISOString(),
      },
    },
  });
});

const batch: UserQuestionData = {
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
    {
      question: "Which regions should we include?",
      header: "Regions",
      multiSelect: true,
      options: [
        { label: "us-east-1", description: "N. Virginia" },
        { label: "eu-west-1", description: "Ireland" },
        { label: "ap-south-1", description: "Mumbai" },
      ],
    },
    {
      question: "How should failures be reported?",
      header: "Reporting",
      options: [
        { label: "Slack", description: "Post to the alerts channel." },
        { label: "Email", description: "Send a digest." },
      ],
    },
  ],
};

const singleBatch: UserQuestionData = {
  questionId: "q-1",
  questions: [batch.questions![0]],
};

const pendingRecord: UserQuestionRecord = { id: "q-1", status: "PENDING" };

function lastSubmittedAnswers(): Record<string, unknown> {
  const call = executeMutation.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return JSON.parse((call![0] as { answers: string }).answers) as Record<
    string,
    unknown
  >;
}

/** Radix tab triggers select on mousedown (not click). */
function selectTab(name: RegExp) {
  fireEvent.mouseDown(screen.getByRole("tab", { name }));
}

describe("UserQuestionCard — pending (tabbed batch)", () => {
  it("renders a three-question batch as one card with a tab strip and one submit button", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(screen.getAllByTestId("user-question-card")).toHaveLength(1);
    // One tab per question, labeled by header.
    expect(screen.getAllByRole("tab")).toHaveLength(3);
    expect(screen.getByRole("tab", { name: /env/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /regions/i })).toBeTruthy();
    expect(screen.getByRole("tab", { name: /reporting/i })).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /submit answers/i }),
    ).toHaveLength(1);
    expect(screen.getByText(/you can also just reply in chat/i)).toBeTruthy();
  });

  it("shows one question at a time — the first question by default", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(
      screen.getByText("Which environment should this target?"),
    ).toBeTruthy();
    expect(screen.queryByText("Which regions should we include?")).toBeNull();
    expect(screen.queryByText("How should failures be reported?")).toBeNull();
  });

  it("switches the visible question when a tab is selected", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    selectTab(/regions/i);

    expect(screen.getByText("Which regions should we include?")).toBeTruthy();
    expect(
      screen.queryByText("Which environment should this target?"),
    ).toBeNull();
  });

  it("auto-advances to the next unanswered question on a single-select choice", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));

    expect(screen.getByText("Which regions should we include?")).toBeTruthy();
    expect(
      (
        screen.getByRole("tab", { name: /regions/i }) as HTMLElement
      ).getAttribute("aria-selected"),
    ).toBe("true");
  });

  it("does NOT auto-advance on a multiSelect choice", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    selectTab(/regions/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /us-east-1/i }));

    // Still on Regions — multiSelect lets you keep picking.
    expect(screen.getByText("Which regions should we include?")).toBeTruthy();
  });

  it("does NOT auto-advance when Other is selected (the inline input must stay visible)", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /^other$/i }));

    expect(
      screen.getByText("Which environment should this target?"),
    ).toBeTruthy();
    expect(screen.getByLabelText(/other answer for env/i)).toBeTruthy();
  });

  it("offers Back/Next navigation between questions", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    const back = screen.getByRole("button", {
      name: /back/i,
    }) as HTMLButtonElement;
    expect(back.disabled).toBe(true);

    fireEvent.click(screen.getByRole("button", { name: /next/i }));
    expect(screen.getByText("Which regions should we include?")).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: /back/i }));
    expect(
      screen.getByText("Which environment should this target?"),
    ).toBeTruthy();
  });

  it("strips the (Recommended) suffix for display and shows a badge", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(screen.getByText("Staging")).toBeTruthy();
    expect(screen.queryByText("Staging (Recommended)")).toBeNull();
    expect(screen.getByText("Recommended")).toBeTruthy();
  });

  it("single-select replaces; the submitted label keeps the (Recommended) suffix", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    // Auto-advanced away — come back and change the answer.
    selectTab(/env/i);
    fireEvent.click(screen.getByRole("radio", { name: /staging/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    const answers = lastSubmittedAnswers();
    // Replaces, not accumulates — and the ORIGINAL label, suffix included.
    expect(answers.Env).toBe("Staging (Recommended)");
  });

  it("multiSelect accumulates labels into an array", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    selectTab(/regions/i);
    fireEvent.click(screen.getByRole("checkbox", { name: /us-east-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /eu-west-1/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    expect(lastSubmittedAnswers().Regions).toEqual(["us-east-1", "eu-west-1"]);
  });

  it("partial submit from any tab sends only answered questions, keyed by header", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    // Auto-advance moved us to the Regions tab — submit still works there.
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    const answers = lastSubmittedAnswers();
    expect(answers).toEqual({ Env: "Production" });
    expect(Object.keys(answers)).not.toContain("Regions");
    expect(Object.keys(answers)).not.toContain("Reporting");
  });

  it("marks answered tabs with a check while unanswered tabs stay muted", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));

    const envTab = screen.getByRole("tab", { name: /env/i });
    const reportingTab = screen.getByRole("tab", { name: /reporting/i });
    expect(envTab.querySelector("svg")).toBeTruthy();
    expect(reportingTab.querySelector("svg")).toBeNull();
    expect(reportingTab.className).toContain("text-muted-foreground");
  });

  it("selecting Other reveals an inline input and submits the typed text", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(screen.queryByLabelText(/other answer for env/i)).toBeNull();
    fireEvent.click(screen.getByRole("radio", { name: /^other$/i }));

    const input = screen.getByLabelText(/other answer for env/i);
    fireEvent.change(input, { target: { value: "A canary environment" } });
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    expect(lastSubmittedAnswers().Env).toBe("A canary environment");
  });

  it("keeps selections when navigating between tabs", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    selectTab(/env/i);

    expect(
      (screen.getByRole("radio", { name: /production/i }) as HTMLInputElement)
        .checked,
    ).toBe(true);
  });

  it("freezes the whole card while the mutation is in flight", () => {
    mutationState.fetching = true;
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(
      screen.getByRole("button", {
        name: /submit answers/i,
      }) as HTMLButtonElement,
    ).toHaveProperty("disabled", true);
    for (const radio of screen.getAllByRole("radio")) {
      expect((radio as HTMLInputElement).disabled).toBe(true);
    }
    for (const tab of screen.getAllByRole("tab")) {
      expect((tab as HTMLButtonElement).disabled).toBe(true);
    }
    expect(screen.getByRole("status", { name: /loading/i })).toBeTruthy();
  });

  it("shows an inline error, keeps selections, and reads Retry after a failure", async () => {
    executeMutation.mockResolvedValueOnce({
      error: {
        message: "[GraphQL] Failed to enqueue the resume wakeup",
        graphQLErrors: [
          {
            message: "Failed to enqueue the resume wakeup",
            extensions: { code: "WAKEUP_ENQUEUE_FAILED" },
          },
        ],
      },
    });

    render(<UserQuestionCard data={batch} question={pendingRecord} />);
    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() =>
      expect(screen.getByRole("alert").textContent).toContain(
        "Failed to enqueue the resume wakeup",
      ),
    );
    // Card is editable again, selection preserved, button reads Retry.
    selectTab(/env/i);
    const production = screen.getByRole("radio", {
      name: /production/i,
    }) as HTMLInputElement;
    expect(production.disabled).toBe(false);
    expect(production.checked).toBe(true);
    fireEvent.click(screen.getByRole("button", { name: /retry/i }));
    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(2));
    expect(lastSubmittedAnswers().Env).toBe("Production");
  });

  it("flips to the answered display on QUESTION_ALREADY_ANSWERED", async () => {
    executeMutation.mockResolvedValueOnce({
      error: {
        message: "[GraphQL] This question has already been answered",
        graphQLErrors: [
          {
            message: "This question has already been answered",
            extensions: { code: "QUESTION_ALREADY_ANSWERED" },
          },
        ],
      },
    });

    render(<UserQuestionCard data={batch} question={pendingRecord} />);
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /submit answers/i }),
      ).toBeNull(),
    );
  });

  it("renders the answered display from the mutation result after submit", async () => {
    executeMutation.mockResolvedValueOnce({
      data: {
        answerUserQuestion: {
          id: "q-1",
          status: "ANSWERED",
          answers: JSON.stringify({ Env: "Production" }),
          answeredVia: "CARD",
          answeredBy: "user-1",
          answeredAt: new Date(Date.now() - 60_000).toISOString(),
        },
      },
    });

    render(<UserQuestionCard data={batch} question={pendingRecord} />);
    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() =>
      expect(
        screen.queryByRole("button", { name: /submit answers/i }),
      ).toBeNull(),
    );
    expect(screen.getByText("Production")).toBeTruthy();
  });
});

describe("UserQuestionCard — pending (single question, no tab chrome)", () => {
  it("renders a single-question batch with no tabs and the header inline", () => {
    render(<UserQuestionCard data={singleBatch} question={pendingRecord} />);

    expect(screen.queryAllByRole("tab")).toHaveLength(0);
    expect(screen.queryByRole("button", { name: /next/i })).toBeNull();
    expect(screen.queryByRole("button", { name: /back/i })).toBeNull();
    expect(screen.getByText("Env")).toBeTruthy();
    expect(
      screen.getByText("Which environment should this target?"),
    ).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /submit answers/i }),
    ).toHaveLength(1);
  });

  it("submits a single-question answer keyed by header", async () => {
    render(<UserQuestionCard data={singleBatch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    expect(lastSubmittedAnswers()).toEqual({ Env: "Production" });
  });
});

describe("UserQuestionCard — answered / cancelled (record-derived)", () => {
  const answeredRecord: UserQuestionRecord = {
    id: "q-1",
    status: "ANSWERED",
    answers: JSON.stringify({
      Env: "Staging (Recommended)",
      Regions: ["us-east-1", "eu-west-1"],
    }),
    answeredVia: "CARD",
    answeredBy: "user-1",
    answeredByDisplayName: "Eric Odom",
    answeredAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  };

  it("renders chosen labels, answered-by name, and a relative timestamp from the record (fresh mount)", () => {
    // A fresh mount with an ANSWERED record — the across-remount /
    // across-device case: no local state, everything from the row.
    render(<UserQuestionCard data={batch} question={answeredRecord} />);

    expect(screen.queryByRole("button", { name: /submit|retry/i })).toBeNull();
    expect(screen.queryByRole("radio")).toBeNull();
    // Chosen labels highlighted; Recommended suffix stripped for display.
    expect(screen.getByText("Staging")).toBeTruthy();
    expect(screen.getByText("us-east-1")).toBeTruthy();
    expect(screen.getByText("eu-west-1")).toBeTruthy();
    expect(screen.getByText(/answered by eric odom/i)).toBeTruthy();
    // Compact shared relative-time format (formatTinyRelativeDate).
    expect(screen.getByText(/· 5m/)).toBeTruthy();
    // Unanswered question in the batch shows as not answered.
    expect(screen.getByText(/not answered/i)).toBeTruthy();
  });

  it("never renders the answeredBy UUID — falls back to a plain Answered byline", () => {
    const { answeredByDisplayName: _omitted, ...withoutName } = answeredRecord;
    render(<UserQuestionCard data={batch} question={withoutName} />);

    expect(screen.queryByText(/user-1/)).toBeNull();
    expect(screen.getByText(/^answered · /i)).toBeTruthy();
  });

  it("reply-answered shows every question (header + text) plus one answered-by-reply line", () => {
    render(
      <UserQuestionCard
        data={batch}
        question={{
          ...answeredRecord,
          answeredVia: "REPLY",
          answers: JSON.stringify({ messageId: "m-2" }),
        }}
      />,
    );

    // Never a contentless shell: what was asked is always visible.
    expect(screen.getByText("Env")).toBeTruthy();
    expect(screen.getByText("Regions")).toBeTruthy();
    expect(screen.getByText("Reporting")).toBeTruthy();
    expect(
      screen.getByText("Which environment should this target?"),
    ).toBeTruthy();
    expect(screen.getByText("Which regions should we include?")).toBeTruthy();
    expect(screen.getByText(/answered by reply — eric odom/i)).toBeTruthy();
    // Options/answers are not shown — the answer lives on the reply message.
    expect(screen.queryByText("Staging")).toBeNull();
    expect(screen.queryByRole("button", { name: /submit|retry/i })).toBeNull();
  });

  it("reply-answered without a resolved name still reads Answered by reply", () => {
    const { answeredByDisplayName: _omitted, ...withoutName } = answeredRecord;
    render(
      <UserQuestionCard
        data={batch}
        question={{
          ...withoutName,
          answeredVia: "REPLY",
          answers: JSON.stringify({ messageId: "m-2" }),
        }}
      />,
    );

    expect(screen.getByText(/answered by reply · 5m/i)).toBeTruthy();
    expect(screen.queryByText(/user-1/)).toBeNull();
  });

  it("renders the pending card when the question record has not hydrated yet", () => {
    // DataLoader not hydrated: the message-level record is undefined but
    // the part still carries the questions — render pending, don't crash.
    render(<UserQuestionCard data={batch} question={undefined} />);

    expect(screen.getAllByTestId("user-question-card")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /submit answers/i }),
    ).toBeTruthy();
    expect(screen.getByRole("tab", { name: /env/i })).toBeTruthy();
  });

  it("renders the cancelled state as a muted line that still shows the question headers", () => {
    render(
      <UserQuestionCard
        data={batch}
        question={{ id: "q-1", status: "CANCELLED" }}
      />,
    );

    expect(
      screen.getByText(/no longer waiting on this question/i),
    ).toBeTruthy();
    expect(screen.getByText("Env")).toBeTruthy();
    expect(screen.getByText("Regions")).toBeTruthy();
    expect(screen.getByText("Reporting")).toBeTruthy();
    expect(screen.queryByRole("button", { name: /submit|retry/i })).toBeNull();
  });
});
