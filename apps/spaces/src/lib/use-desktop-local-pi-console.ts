import { useEffect, useState } from "react";
import type { PiDiagnosticEvent } from "@thinkwork/desktop-ipc";
import { getDesktopBridge } from "@/lib/desktop-runtime";

const MAX_CONSOLE_EVENTS = 200;

export interface DesktopLocalPiConsoleEntry extends PiDiagnosticEvent {
  id: string;
}

export function useDesktopLocalPiConsole(
  threadId: string | null,
): DesktopLocalPiConsoleEntry[] {
  const bridge = getDesktopBridge();
  const [entries, setEntries] = useState<DesktopLocalPiConsoleEntry[]>([]);

  useEffect(() => {
    if (!bridge?.pi?.onDiagnostic) {
      setEntries([]);
      return;
    }

    const unsubscribe = bridge.pi.onDiagnostic((event) => {
      if (threadId && event.threadId && event.threadId !== threadId) return;
      setEntries((current) =>
        [
          ...current,
          {
            ...event,
            id: `${event.emittedAt}:${event.source}:${current.length}`,
          },
        ].slice(-MAX_CONSOLE_EVENTS),
      );
    });

    return unsubscribe;
  }, [bridge, threadId]);

  return entries;
}
