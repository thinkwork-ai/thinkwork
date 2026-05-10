import { useMemo } from "react";
import {
  aguiEventsFromChunk,
  aguiEventsFromComputerEvents,
  mergeAguiEvents,
} from "./event-mapping";
import type { AguiChunkInput, AguiComputerEventInput } from "./events";

export interface UseAguiThreadStreamInput {
  threadId?: string | null;
  chunks?: AguiChunkInput[];
  computerEvents?: AguiComputerEventInput[];
}

export function useAguiThreadStream({
  chunks = [],
  computerEvents = [],
}: UseAguiThreadStreamInput) {
  const persistedEvents = useMemo(
    () => aguiEventsFromComputerEvents(computerEvents),
    [computerEvents],
  );
  const liveEvents = useMemo(
    () => chunks.flatMap(aguiEventsFromChunk),
    [chunks],
  );

  const events = useMemo(
    () => mergeAguiEvents(persistedEvents, liveEvents),
    [liveEvents, persistedEvents],
  );

  return useMemo(
    () => ({
      events,
      diagnostics: events.filter((event) => event.type === "diagnostic"),
    }),
    [events],
  );
}
