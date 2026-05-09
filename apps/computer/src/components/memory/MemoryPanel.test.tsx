import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { MemoryPanel } from "./MemoryPanel";

afterEach(cleanup);

describe("MemoryPanel", () => {
  it("renders grouped memory records", () => {
    render(
      <MemoryPanel
        records={[
          {
            memoryRecordId: "memory-1",
            content: { text: "Eric prefers concise status updates." },
            factType: "preference",
            confidence: 0.92,
            tags: ["communication"],
            updatedAt: "2026-05-08T12:00:00Z",
          },
        ]}
      />,
    );

    // Page title now lives in AppTopBar via PageHeaderContext.
    expect(screen.getByText("Preferences")).toBeTruthy();
    expect(
      screen.getByText("Eric prefers concise status updates."),
    ).toBeTruthy();
    expect(screen.getByText("92% confidence")).toBeTruthy();
    expect(screen.getByText("communication")).toBeTruthy();
  });

  it("confirms before forgetting a memory", async () => {
    const onForget = vi.fn();
    render(
      <MemoryPanel
        records={[
          {
            memoryRecordId: "memory-1",
            content: { text: "A disposable fact." },
          },
        ]}
        onForget={onForget}
      />,
    );

    fireEvent.click(screen.getByLabelText("Forget memory: A disposable fact."));
    expect(screen.getByText("Forget this memory?")).toBeTruthy();
    fireEvent.click(screen.getByRole("button", { name: "Forget" }));

    expect(onForget).toHaveBeenCalledWith("memory-1");
  });
});
