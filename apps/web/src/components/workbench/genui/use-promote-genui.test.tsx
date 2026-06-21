import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createTaskReviewGenUIFixture } from "@thinkwork/genui";
import { usePromoteGenUI } from "./use-promote-genui";

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
    data: {
      promoteGenUIArtifact: {
        id: "artifact-1",
        title: "Onboarding task review",
      },
    },
  });
});

afterEach(cleanup);

describe("usePromoteGenUI", () => {
  it("promotes a persisted GenUI part through the host mutation", async () => {
    const fixture = createTaskReviewGenUIFixture();
    render(
      <PromotionHarness
        data={fixture.data}
        partId={fixture.id}
        sourceMessageId="message-1"
        threadId="thread-1"
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Promote" }));

    await waitFor(() => {
      expect(executeMutation).toHaveBeenCalledTimes(1);
    });
    expect(executeMutation.mock.calls[0][0].input).toMatchObject({
      threadId: "thread-1",
      sourceMessageId: "message-1",
      partId: fixture.id,
      specHash: fixture.data.specHash,
    });
    await waitFor(() => {
      expect(screen.getByText("promoted:artifact-1")).toBeTruthy();
    });
  });

  it("keeps live GenUI parts non-promotable before a source message exists", () => {
    const fixture = createTaskReviewGenUIFixture();
    render(<PromotionHarness data={fixture.data} partId={fixture.id} />);

    expect(
      (screen.getByRole("button", { name: "Promote" }) as HTMLButtonElement)
        .disabled,
    ).toBe(true);
    expect(screen.getByText("idle")).toBeTruthy();
  });
});

function PromotionHarness(props: Parameters<typeof usePromoteGenUI>[0]) {
  const promotion = usePromoteGenUI(props);
  return (
    <div>
      <button
        type="button"
        disabled={!promotion.canPromote}
        onClick={promotion.promote}
      >
        Promote
      </button>
      <span>
        {promotion.status.state === "promoted"
          ? `promoted:${promotion.status.artifactId}`
          : promotion.status.state}
      </span>
    </div>
  );
}
