import { useEffect, useState } from "react";

/**
 * Live elapsed milliseconds for a running turn (plan U3).
 *
 * Recomputes from wall-clock (`Date.now() - startedAt`) on each 1s tick
 * rather than incrementing a counter, so a backgrounded tab (whose timers
 * are throttled) still shows the correct elapsed when it returns to the
 * foreground. The value is derived from `startedAt`, so a parent re-render
 * never resets it to zero.
 *
 * Returns `null` when there is no valid `startedAt` (e.g. a queued turn).
 * When `isRunning` flips false the interval is cleared and the last value
 * freezes; callers should render the authoritative final duration from
 * `startedAt`/`finishedAt` for terminal turns.
 *
 * One hook instance per turn surface — the timer is scoped to the
 * component, so historical turns don't animate.
 */
export function useTurnElapsed(
  startedAt: string | null | undefined,
  isRunning: boolean,
): number | null {
  const startMs = startedAt ? Date.parse(startedAt) : Number.NaN;
  const hasStart = Number.isFinite(startMs);

  const [now, setNow] = useState(() => Date.now());

  useEffect(() => {
    if (!isRunning || !hasStart) return;
    setNow(Date.now());
    const id = setInterval(() => setNow(Date.now()), 1000);
    return () => clearInterval(id);
  }, [isRunning, hasStart, startMs]);

  if (!hasStart) return null;
  return Math.max(0, now - startMs);
}
