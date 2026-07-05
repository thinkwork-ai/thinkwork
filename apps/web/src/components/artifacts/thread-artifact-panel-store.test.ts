import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  closeThreadArtifactPanel,
  getOpenThreadArtifactId,
  openThreadArtifactPanel,
  resetThreadArtifactPanels,
  subscribeThreadArtifactPanel,
  useThreadArtifactPanel,
} from "./thread-artifact-panel-store";

afterEach(() => {
  resetThreadArtifactPanels();
});

describe("thread-artifact-panel-store", () => {
  it("keys open state per thread", () => {
    openThreadArtifactPanel("thread-a", "artifact-1");
    openThreadArtifactPanel("thread-b", "artifact-2");

    expect(getOpenThreadArtifactId("thread-a")).toBe("artifact-1");
    expect(getOpenThreadArtifactId("thread-b")).toBe("artifact-2");

    closeThreadArtifactPanel("thread-a");
    expect(getOpenThreadArtifactId("thread-a")).toBeNull();
    expect(getOpenThreadArtifactId("thread-b")).toBe("artifact-2");
  });

  it("notifies subscribers on open and close, not on no-ops", () => {
    const listener = vi.fn();
    const unsubscribe = subscribeThreadArtifactPanel(listener);

    openThreadArtifactPanel("thread-a", "artifact-1");
    expect(listener).toHaveBeenCalledTimes(1);

    // Re-opening the same artifact is a no-op.
    openThreadArtifactPanel("thread-a", "artifact-1");
    expect(listener).toHaveBeenCalledTimes(1);

    // Closing an already-closed thread is a no-op.
    closeThreadArtifactPanel("thread-b");
    expect(listener).toHaveBeenCalledTimes(1);

    closeThreadArtifactPanel("thread-a");
    expect(listener).toHaveBeenCalledTimes(2);

    unsubscribe();
    openThreadArtifactPanel("thread-a", "artifact-1");
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it("useThreadArtifactPanel reflects the store and survives remounts", () => {
    const first = renderHook(() => useThreadArtifactPanel("thread-a"));
    expect(first.result.current.artifactId).toBeNull();

    act(() => first.result.current.open("artifact-1"));
    expect(first.result.current.artifactId).toBe("artifact-1");

    // Unmount + fresh mount (message-send refetch churn can remount the
    // thread view) — the selection survives because it lives in the store.
    first.unmount();
    const second = renderHook(() => useThreadArtifactPanel("thread-a"));
    expect(second.result.current.artifactId).toBe("artifact-1");

    act(() => second.result.current.close());
    expect(second.result.current.artifactId).toBeNull();
  });

  it("returns null and ignores open/close when threadId is missing", () => {
    const { result } = renderHook(() => useThreadArtifactPanel(null));
    expect(result.current.artifactId).toBeNull();
    act(() => result.current.open("artifact-1"));
    expect(result.current.artifactId).toBeNull();
  });
});
