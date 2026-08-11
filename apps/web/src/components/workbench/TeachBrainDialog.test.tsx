/**
 * Teach-the-Brain dialog tests (THINK-784).
 *
 * Pins the dialog contract: submit stays disabled until the required
 * statement exists, the mutation receives {text} (plus threadId when
 * taught from a thread — never a typed identity), success confirms
 * inline with the honest review copy and short teaching id, and errors
 * keep the form up for a retry.
 */

import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation } from "urql";
import { TeachBrainDialog } from "./TeachBrainDialog";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
  };
});

const teachMutation = vi.fn();

beforeEach(() => {
  teachMutation.mockReset();
  teachMutation.mockResolvedValue({
    data: {
      teachBrain: {
        teachingId: "abcd1234-5678-4abc-8def-000000000000",
        taskId: "task-1",
        note: null,
      },
    },
  });
  vi.mocked(useMutation).mockImplementation(
    () => [{ fetching: false, stale: false }, teachMutation] as never,
  );
});

afterEach(() => {
  cleanup();
  vi.mocked(useMutation).mockReset();
});

describe("TeachBrainDialog", () => {
  it("submit is disabled until the statement has content", () => {
    render(<TeachBrainDialog open onOpenChange={vi.fn()} />);
    const submit = () =>
      screen.getByTestId("teach-brain-submit") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("teach-brain-text"), {
      target: { value: "   " },
    });
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("teach-brain-text"), {
      target: { value: "The Waco generator is nicknamed the Beast." },
    });
    expect(submit().disabled).toBe(false);
  });

  it("teaches globally with {text} only — no identity typed, no thread", async () => {
    render(<TeachBrainDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("teach-brain-text"), {
      target: { value: "  The Waco generator is nicknamed the Beast.  " },
    });
    fireEvent.click(screen.getByTestId("teach-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("teach-brain-confirmation")).toBeTruthy(),
    );
    expect(teachMutation).toHaveBeenCalledWith({
      input: { text: "The Waco generator is nicknamed the Beast." },
    });
    expect(
      screen.getByText(
        /Sent for review — an operator admits it before the Brain uses it\./,
      ),
    ).toBeTruthy();
    // Short-form id, not the full UUID.
    expect(screen.getByText(/Teaching abcd1234/)).toBeTruthy();
  });

  it("includes threadId when taught from a conversation", async () => {
    render(
      <TeachBrainDialog open onOpenChange={vi.fn()} threadId="thread-1" />,
    );
    fireEvent.change(screen.getByTestId("teach-brain-text"), {
      target: { value: "teach with context" },
    });
    fireEvent.click(screen.getByTestId("teach-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("teach-brain-confirmation")).toBeTruthy(),
    );
    expect(teachMutation).toHaveBeenCalledWith({
      input: { text: "teach with context", threadId: "thread-1" },
    });
  });

  it("answers an expert question: shows the question and sends answersQuestionId", async () => {
    render(
      <TeachBrainDialog
        open
        onOpenChange={vi.fn()}
        question={{
          id: "11111111-1111-4111-8111-111111111111",
          question: "What is the Waco generator's nickname?",
          why: "Two conflicting names in the data.",
        }}
      />,
    );
    expect(screen.getByText("The Brain has a question for you")).toBeTruthy();
    expect(
      screen.getByText("What is the Waco generator's nickname?"),
    ).toBeTruthy();

    fireEvent.change(screen.getByTestId("teach-brain-text"), {
      target: { value: "The Beast." },
    });
    fireEvent.click(screen.getByTestId("teach-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("teach-brain-confirmation")).toBeTruthy(),
    );
    expect(teachMutation).toHaveBeenCalledWith({
      input: {
        text: "The Beast.",
        answersQuestionId: "11111111-1111-4111-8111-111111111111",
      },
    });
  });

  it("surfaces a mutation error inline and keeps the form for retry", async () => {
    teachMutation.mockResolvedValue({
      error: {
        message: "[GraphQL] The Brain rejected the teaching: bad domain",
        graphQLErrors: [
          { message: "The Brain rejected the teaching: bad domain" },
        ],
      },
    });
    render(<TeachBrainDialog open onOpenChange={vi.fn()} />);
    fireEvent.change(screen.getByTestId("teach-brain-text"), {
      target: { value: "teach" },
    });
    fireEvent.click(screen.getByTestId("teach-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("teach-brain-error")).toBeTruthy(),
    );
    expect(
      screen.getByText(/The Brain rejected the teaching: bad domain/),
    ).toBeTruthy();
    expect(screen.getByTestId("teach-brain-submit")).toBeTruthy();
    expect(screen.queryByTestId("teach-brain-confirmation")).toBeNull();
  });
});
