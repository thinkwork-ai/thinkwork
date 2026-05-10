import { useCallback, useEffect, useMemo, useState } from "react";
import { useSubscription } from "urql";
import { ComputerThreadChunkSubscription } from "@/lib/graphql-queries";
import {
	emptyState,
	mergeUIMessageChunk,
	type UIMessageStreamState,
} from "./ui-message-merge";

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

/**
 * Subscribes to onComputerThreadChunk and exposes both the legacy
 * `{seq, text}` accumulator (for the pre-U8 thread surface) AND a typed
 * `UIMessageStreamState` accumulator (per plan-012 U6 contract) that uses
 * per-part-id append cursors.
 *
 * Legacy field `chunks` keeps the existing shape so the live thread
 * surface (`StreamingMessageBuffer`, `TaskThreadView`) continues to render
 * unchanged until U8 wires `useChat` and the typed merge result. Once U8
 * lands, the legacy `chunks` accumulator becomes the U8 fallback path for
 * messages that arrive without a `parts`-shaped chunk; the U6 cleanup
 * follow-up retires it.
 *
 * Plan-012 U6 explicitly retires the `seq < highest - 2` chunk-window
 * heuristic for typed chunks (per-part-id cursors handle out-of-order
 * arrival without dropping). The legacy accumulator still uses seq for
 * deduplication of legacy `{text}` chunks but no longer drops by window.
 */
export function useComputerThreadChunks(threadId: string | null | undefined) {
	const [chunks, setChunks] = useState<ComputerThreadChunk[]>([]);
	const [streamState, setStreamState] = useState<UIMessageStreamState>(
		() => emptyState(),
	);
	const reset = useCallback(() => {
		setChunks([]);
		setStreamState(emptyState());
	}, []);

	useEffect(() => {
		setChunks([]);
		setStreamState(emptyState());
	}, [threadId]);

	useSubscription<ChunkSubscriptionResult>(
		{
			query: ComputerThreadChunkSubscription,
			variables: { threadId },
			pause: !threadId,
		},
		(_previous, event) => {
			const eventChunk = event.onComputerThreadChunk;
			if (!eventChunk) return event;
			// Feed the raw chunk payload into the typed merge — its parser
			// detects legacy {text} envelopes by shape and routes them to
			// streamState.legacyText, leaving streamState.parts untouched.
			setStreamState((current) => mergeUIMessageChunk(current, eventChunk.chunk));

			// Legacy accumulator: keep populating for the pre-U8 thread surface.
			const next = toComputerThreadChunk(eventChunk);
			if (next) {
				setChunks((current) => mergeComputerThreadChunk(current, next));
			}
			return event;
		},
	);

	return useMemo(
		() => ({ chunks, streamState, reset }),
		[chunks, streamState, reset],
	);
}

/**
 * Append-and-deduplicate by seq. Plan-012 U6 retires the
 * `seq < highest - 2` window — typed chunks rely on per-part-id cursors
 * (in `ui-message-merge.ts`) instead, and legacy `{text}` chunks should
 * never arrive far behind in practice. We still dedup by seq to defend
 * against AppSync redelivery.
 */
export function mergeComputerThreadChunk(
	current: ComputerThreadChunk[],
	next: ComputerThreadChunk,
) {
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
