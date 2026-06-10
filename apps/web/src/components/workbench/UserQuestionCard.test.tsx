/**
 * UserQuestionCard tests (plan 2026-06-09-005 U8).
 *
 * Covers AE5 (three-question batch → one card, one submit) plus the
 * answer-payload wire convention: answers keyed by question HEADER,
 * single-select = label string, multiSelect = array of labels, "Other" =
 * the typed text, and " (Recommended)" suffixes submitted verbatim while
 * stripped for display. Answered state always renders from the question
 * RECORD, never local component state.
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

const pendingRecord: UserQuestionRecord = { id: "q-1", status: "PENDING" };

function lastSubmittedAnswers(): Record<string, unknown> {
  const call = executeMutation.mock.calls.at(-1);
  expect(call).toBeTruthy();
  return JSON.parse((call![0] as { answers: string }).answers) as Record<
    string,
    unknown
  >;
}

describe("UserQuestionCard — pending", () => {
  it("renders a three-question batch as one card with one submit button", () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(screen.getAllByTestId("user-question-card")).toHaveLength(1);
    expect(screen.getByText("Env")).toBeTruthy();
    expect(screen.getByText("Regions")).toBeTruthy();
    expect(screen.getByText("Reporting")).toBeTruthy();
    expect(
      screen.getAllByRole("button", { name: /submit answers/i }),
    ).toHaveLength(1);
    expect(screen.getByText(/you can also just reply in chat/i)).toBeTruthy();
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
    fireEvent.click(screen.getByRole("radio", { name: /staging/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    const answers = lastSubmittedAnswers();
    // Replaces, not accumulates — and the ORIGINAL label, suffix included.
    expect(answers.Env).toBe("Staging (Recommended)");
  });

  it("multiSelect accumulates labels into an array", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("checkbox", { name: /us-east-1/i }));
    fireEvent.click(screen.getByRole("checkbox", { name: /eu-west-1/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    expect(lastSubmittedAnswers().Regions).toEqual(["us-east-1", "eu-west-1"]);
  });

  it("partial submit sends only answered questions, keyed by header", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    fireEvent.click(screen.getByRole("radio", { name: /production/i }));
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    const answers = lastSubmittedAnswers();
    expect(answers).toEqual({ Env: "Production" });
    expect(Object.keys(answers)).not.toContain("Regions");
    expect(Object.keys(answers)).not.toContain("Reporting");
  });

  it("selecting Other reveals an inline input and submits the typed text", async () => {
    render(<UserQuestionCard data={batch} question={pendingRecord} />);

    expect(screen.queryByLabelText(/other answer for env/i)).toBeNull();
    const otherRadios = screen.getAllByRole("radio", { name: /^other$/i });
    fireEvent.click(otherRadios[0]);

    const input = screen.getByLabelText(/other answer for env/i);
    fireEvent.change(input, { target: { value: "A canary environment" } });
    fireEvent.click(screen.getByRole("button", { name: /submit answers/i }));

    await waitFor(() => expect(executeMutation).toHaveBeenCalledTimes(1));
    expect(lastSubmittedAnswers().Env).toBe("A canary environment");
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
    for (const checkbox of screen.getAllByRole("checkbox")) {
      expect((checkbox as HTMLInputElement).disabled).toBe(true);
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

  it("renders the answered-by-reply state for REPLY consumption", () => {
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

    expect(screen.getByText(/answered by reply/i)).toBeTruthy();
    expect(screen.queryByText("Staging")).toBeNull();
    expect(screen.queryByRole("button", { name: /submit|retry/i })).toBeNull();
  });

  it("renders the pending card when the question record has not hydrated yet", () => {
    // DataLoader not hydrated: the message-level record is undefined but
    // the part still carries the questions — render pending, don't crash.
    render(<UserQuestionCard data={batch} question={undefined} />);

    expect(screen.getAllByTestId("user-question-card")).toHaveLength(1);
    expect(
      screen.getByRole("button", { name: /submit answers/i }),
    ).toBeTruthy();
    expect(screen.getByText("Env")).toBeTruthy();
  });

  it("renders the cancelled state as a muted line", () => {
    render(
      <UserQuestionCard
        data={batch}
        question={{ id: "q-1", status: "CANCELLED" }}
      />,
    );

    expect(
      screen.getByText(/no longer waiting on this question/i),
    ).toBeTruthy();
    expect(screen.queryByRole("button", { name: /submit|retry/i })).toBeNull();
  });
});
