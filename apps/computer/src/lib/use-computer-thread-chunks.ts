import { useCallback, useEffect, useMemo, useState } from "react";
import { useSubscription } from "urql";
import { ComputerThreadChunkSubscription } from "@/lib/graphql-queries";

export interface ComputerThreadChunk {
  seq: number;
  text: string;
  publishedAt?: string | null;
}

interface ChunkSubscriptionResult {
  onComputerThreadChunk?: {
    threadId: string;
    chunk?: unknown;
    seq?: number | null;
    publishedAt?: string | null;
  } | null;
}

export function useComputerThreadChunks(threadId: string | null | undefined) {
  const [chunks, setChunks] = useState<ComputerThreadChunk[]>([]);
  const reset = useCallback(() => {
    setChunks([]);
  }, []);

  useEffect(() => {
    setChunks([]);
  }, [threadId]);

  useSubscription<ChunkSubscriptionResult>(
    {
      query: ComputerThreadChunkSubscription,
      variables: { threadId },
      pause: !threadId,
    },
    (_previous, event) => {
      const next = toComputerThreadChunk(event.onComputerThreadChunk);
      if (next) {
        setChunks((current) => mergeComputerThreadChunk(current, next));
      }
      return event;
    },
  );

  return useMemo(() => ({ chunks, reset }), [chunks, reset]);
}

export function mergeComputerThreadChunk(
  current: ComputerThreadChunk[],
  next: ComputerThreadChunk,
) {
  const highestSeq = current.reduce(
    (max, chunk) => Math.max(max, chunk.seq),
    0,
  );
  if (highestSeq > 0 && next.seq < highestSeq - 2) return current;
  const withoutDuplicate = current.filter((chunk) => chunk.seq !== next.seq);
  return [...withoutDuplicate, next].sort((a, b) => a.seq - b.seq);
}

function toComputerThreadChunk(
  event: ChunkSubscriptionResult["onComputerThreadChunk"],
): ComputerThreadChunk | null {
  if (!event || typeof event.seq !== "number") return null;
  const chunk = parseChunk(event.chunk);
  if (!chunk.text) return null;
  return {
    seq: event.seq,
    text: chunk.text,
    publishedAt: event.publishedAt ?? null,
  };
}

function parseChunk(value: unknown): { text: string } {
  if (typeof value === "string") {
    try {
      const parsed = JSON.parse(value) as { text?: unknown };
      return { text: typeof parsed.text === "string" ? parsed.text : "" };
    } catch {
      return { text: "" };
    }
  }
  if (value && typeof value === "object" && "text" in value) {
    const text = (value as { text?: unknown }).text;
    return { text: typeof text === "string" ? text : "" };
  }
  return { text: "" };
}
