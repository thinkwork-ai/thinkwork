import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  createPrimitiveJsonRenderFixture,
  createTaskReviewJsonRenderFixture,
} from "./fixtures";
import { ThreadJsonRenderFallback } from "./ThreadJsonRenderFallback";
import { ThreadJsonRenderRenderer } from "./ThreadJsonRenderRenderer";

const mocks = vi.hoisted(() => ({
  executeMutation: vi.fn(),
}));

vi.mock("urql", () => ({
  useMutation: () => [undefined, mocks.executeMutation],
}));

beforeEach(() => {
  mocks.executeMutation.mockResolvedValue({});
});

afterEach(() => {
  cleanup();
  mocks.executeMutation.mockReset();
});

describe("ThreadJsonRenderRenderer", () => {
  it("renders nested upstream shadcn primitive specs through json-render", () => {
    const fixture = createPrimitiveJsonRenderFixture();

    render(
      <ThreadJsonRenderRenderer data={fixture.data} partId={fixture.id} />,
    );

    expect(screen.getByText("Pipeline health")).toBeTruthy();
    expect(screen.getByText("All checks are ready.")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Approve" })).toBeTruthy();
  });

  it("renders ThinkWork domain entries through json-render registry adapters", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    render(
      <ThreadJsonRenderRenderer
        data={fixture.data}
        partId={fixture.id}
        sourceMessageId="message-1"
        threadId="thread-1"
      />,
    );

    expect(screen.getByTestId("genui-task-review")).toBeTruthy();
    expect(screen.getByText("Review onboarding task")).toBeTruthy();
    expect(
      screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"),
    ).toBe(false);
  });

  it("submits durable actions through the json-render action mutation", async () => {
    const fixture = createTaskReviewJsonRenderFixture();

    render(
      <ThreadJsonRenderRenderer
        data={fixture.data}
        partId={fixture.id}
        sourceMessageId="message-1"
        threadId="thread-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));

    await waitFor(() => expect(mocks.executeMutation).toHaveBeenCalledTimes(1));
    expect(mocks.executeMutation.mock.calls[0][0]).toEqual({
      input: {
        threadId: "thread-1",
        sourceMessageId: "message-1",
        partId: fixture.id,
        actionId: "approve-task",
        specHash: fixture.data.specHash,
        idempotencyKey: expect.stringMatching(
          /^json-render-action:json-render-fnv1a:[a-f0-9]{8}$/,
        ),
        params: { taskId: "task-123" },
      },
    });
  });

  it("keeps durable actions disabled before a source message exists", () => {
    const fixture = createTaskReviewJsonRenderFixture();

    render(
      <ThreadJsonRenderRenderer
        data={fixture.data}
        partId={fixture.id}
        live
        threadId="thread-1"
      />,
    );

    expect(
      screen.getByRole("button", { name: "Approve" }).hasAttribute("disabled"),
    ).toBe(true);
  });

  it("fails closed to compact fallback for invalid data", () => {
    render(<ThreadJsonRenderRenderer data={null} />);

    expect(screen.getByTestId("json-render-fallback")).toBeTruthy();
    expect(screen.getByText("Generated UI unavailable")).toBeTruthy();
  });

  it("renders the legacy generated UI fallback state", () => {
    render(
      <ThreadJsonRenderFallback
        component="task.review"
        fallback={{
          title: "Legacy task review",
          summary: "Old generated UI shape.",
        }}
        legacy
      />,
    );

    expect(screen.getByTestId("json-render-legacy-fallback")).toBeTruthy();
    expect(screen.getByText("Legacy generated UI unsupported")).toBeTruthy();
    expect(screen.getByText("task.review")).toBeTruthy();
  });
});
