import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";
import { GenUIRenderer } from "./GenUIRenderer";

const executeMutation = vi.fn();

vi.mock("urql", async () => {
  const actual = await vi.importActual<typeof import("urql")>("urql");
  return {
    ...actual,
    useMutation: () => [{ fetching: false }, executeMutation],
  };
});

beforeEach(() => {
  executeMutation.mockReset();
  executeMutation.mockResolvedValue({
    data: { handleGenUIAction: { id: "message-action-1" } },
  });
});

afterEach(cleanup);

describe("useGenUIAction", () => {
  it("submits persisted GenUI action through the host mutation", async () => {
    const fixture = createTaskReviewGenUIFixture();
    render(
      <GenUIRenderer
        data={fixture.data}
        partId={fixture.id}
        sourceMessageId="message-1"
        threadId="thread-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => {
      expect(executeMutation).toHaveBeenCalledTimes(1);
    });
    expect(executeMutation.mock.calls[0][0].input).toMatchObject({
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      actionId: "approve-task",
      specHash: fixture.data.specHash,
      params: { taskId: "task-123" },
    });
    await waitFor(() => {
      expect(
        screen.getByRole("button", { name: "Approve" }).textContent,
      ).toContain("Submitted");
    });
  });

  it("keeps live GenUI actions disabled before a source message exists", () => {
    const fixture = createTaskReviewGenUIFixture();
    render(<GenUIRenderer data={fixture.data} partId={fixture.id} live />);

    expect(
      (screen.getByRole("button", { name: "Approve" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(executeMutation).not.toHaveBeenCalled();
  });
});
