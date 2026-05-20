import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThreadComposer } from "./ThreadComposer";
import type { MentionTarget } from "./MentionMenu";

afterEach(cleanup);

const mentionTargets: MentionTarget[] = [
  {
    id: "agent:a1",
    targetType: "AGENT",
    targetId: "a1",
    displayName: "Coordinator",
    role: "coordinator",
  },
];

describe("ThreadComposer", () => {
  it("selects a mention and submits structured mention data", async () => {
    const onSend = vi.fn();
    render(<ThreadComposer mentionTargets={mentionTargets} onSend={onSend} />);

    fireEvent.change(screen.getByPlaceholderText("Message"), {
      target: { value: "@coor" },
    });
    fireEvent.click(await screen.findByRole("option", { name: /Coordinator/ }));
    fireEvent.change(screen.getByPlaceholderText("Message"), {
      target: { value: "@Coordinator please check credit" },
    });
    fireEvent.click(screen.getByRole("button", { name: "Send message" }));

    await waitFor(() => expect(onSend).toHaveBeenCalledTimes(1));
    expect(onSend.mock.calls[0][0]).toBe("@Coordinator please check credit");
    expect(onSend.mock.calls[0][2]).toEqual([
      {
        targetType: "AGENT",
        targetId: "a1",
        displayName: "Coordinator",
        rawText: "@Coordinator",
      },
    ]);
  });
});
