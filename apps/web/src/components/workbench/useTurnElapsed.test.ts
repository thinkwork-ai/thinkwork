import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useTurnElapsed } from "./useTurnElapsed";

describe("useTurnElapsed", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-05-28T18:00:10.000Z"));
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("returns null when there is no startedAt", () => {
    const { result } = renderHook(() => useTurnElapsed(null, true));
    expect(result.current).toBeNull();
  });

  it("returns null for an unparseable startedAt", () => {
    const { result } = renderHook(() => useTurnElapsed("not-a-date", true));
    expect(result.current).toBeNull();
  });

  it("advances roughly one second per tick while running", () => {
    const startedAt = "2026-05-28T18:00:00.000Z"; // 10s before "now"
    const { result } = renderHook(() => useTurnElapsed(startedAt, true));

    expect(result.current).toBe(10_000);

    act(() => {
      vi.advanceTimersByTime(1000);
    });
    expect(result.current).toBe(11_000);

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    expect(result.current).toBe(13_000);
  });

  it("freezes the value once the turn stops running", () => {
    const startedAt = "2026-05-28T18:00:00.000Z";
    const { result, rerender } = renderHook(
      ({ running }) => useTurnElapsed(startedAt, running),
      { initialProps: { running: true } },
    );

    act(() => {
      vi.advanceTimersByTime(2000);
    });
    const frozen = result.current;
    expect(frozen).toBe(12_000);

    rerender({ running: false });

    act(() => {
      vi.advanceTimersByTime(5000);
    });
    expect(result.current).toBe(frozen);
  });

  it("does not reset to zero on a re-render", () => {
    const startedAt = "2026-05-28T18:00:00.000Z";
    const { result, rerender } = renderHook(() =>
      useTurnElapsed(startedAt, true),
    );

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current).toBe(13_000);

    rerender();
    expect(result.current).toBe(13_000);
  });
});
