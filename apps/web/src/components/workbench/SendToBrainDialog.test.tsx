/**
 * Send-to-the-Brain dialog tests (THINK-781).
 *
 * Pins the dialog contract: submit stays disabled until the required
 * "what looks wrong" note exists, the mutation receives {threadId, note},
 * success confirms inline with the returned task id (no toast), a Brain
 * 4xx surfaces the server's validation message, and unreachable errors
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
import { SendToBrainDialog } from "./SendToBrainDialog";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useMutation: vi.fn(),
  };
});

const flagMutation = vi.fn();

function renderDialog() {
  return render(
    <SendToBrainDialog open onOpenChange={vi.fn()} threadId="thread-1" />,
  );
}

beforeEach(() => {
  flagMutation.mockReset();
  flagMutation.mockResolvedValue({
    data: {
      flagThreadToBrain: { flagId: "flag-1", taskId: "task-1", note: null },
    },
  });
  vi.mocked(useMutation).mockImplementation(
    () => [{ fetching: false, stale: false }, flagMutation] as never,
  );
});

afterEach(() => {
  cleanup();
  vi.mocked(useMutation).mockReset();
});

describe("SendToBrainDialog", () => {
  it("submit is disabled until the note has content", () => {
    renderDialog();
    const submit = () =>
      screen.getByTestId("send-to-brain-submit") as HTMLButtonElement;
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("send-to-brain-note"), {
      target: { value: "   " },
    });
    expect(submit().disabled).toBe(true);

    fireEvent.change(screen.getByTestId("send-to-brain-note"), {
      target: { value: "The payment conclusion is false." },
    });
    expect(submit().disabled).toBe(false);
  });

  it("submits {threadId, note} and confirms inline with the task id", async () => {
    renderDialog();
    fireEvent.change(screen.getByTestId("send-to-brain-note"), {
      target: { value: "  The payment conclusion is false.  " },
    });
    fireEvent.click(screen.getByTestId("send-to-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("send-to-brain-confirmation")).toBeTruthy(),
    );
    expect(flagMutation).toHaveBeenCalledWith({
      input: {
        threadId: "thread-1",
        note: "The payment conclusion is false.",
      },
    });
    expect(
      screen.getByText(
        /The Brain is investigating — you'll hear back via your operator\./,
      ),
    ).toBeTruthy();
    expect(screen.getByText(/Task task-1/)).toBeTruthy();
  });

  it("falls back to the flag id and shows the Brain's note when dispatch was deferred", async () => {
    flagMutation.mockResolvedValue({
      data: {
        flagThreadToBrain: {
          flagId: "flag-9",
          taskId: null,
          note: "queued: platform agent busy",
        },
      },
    });
    renderDialog();
    fireEvent.change(screen.getByTestId("send-to-brain-note"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("send-to-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("send-to-brain-confirmation")).toBeTruthy(),
    );
    expect(
      screen.getByText(/Flag flag-9 — queued: platform agent busy/),
    ).toBeTruthy();
  });

  it("surfaces a mutation error inline and keeps the form for retry", async () => {
    flagMutation.mockResolvedValue({
      error: {
        message: "[GraphQL] Couldn't reach the Brain — try again.",
        graphQLErrors: [{ message: "Couldn't reach the Brain — try again." }],
      },
    });
    renderDialog();
    fireEvent.change(screen.getByTestId("send-to-brain-note"), {
      target: { value: "wrong" },
    });
    fireEvent.click(screen.getByTestId("send-to-brain-submit"));

    await waitFor(() =>
      expect(screen.getByTestId("send-to-brain-error")).toBeTruthy(),
    );
    expect(
      screen.getByText(/Couldn't reach the Brain — try again\./),
    ).toBeTruthy();
    // The form is still up — the user can retry.
    expect(screen.getByTestId("send-to-brain-submit")).toBeTruthy();
    expect(screen.queryByTestId("send-to-brain-confirmation")).toBeNull();
  });
});
