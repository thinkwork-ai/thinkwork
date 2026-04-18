import { useEffect, useState } from "react";
import { useCaptureMobileMemory } from "@thinkwork/react-native-sdk";
import { captureQueue, type QueuedCapture } from "./capture-queue";

/**
 * Subscribe React components to the capture queue's entries. Re-renders
 * whenever enqueue/retry/remove/sync fires.
 */
export function useCaptureQueue(): QueuedCapture[] {
	const [entries, setEntries] = useState<QueuedCapture[]>(() => captureQueue.snapshot());
	useEffect(() => captureQueue.subscribe(setEntries), []);
	return entries;
}

/**
 * Wires the SDK mutation hook as the queue's sender. Mount once at the
 * Memories tab level so the queue can retry on app foreground / backoff
 * without depending on which React tree is currently rendered.
 */
export function useCaptureQueueSender(): void {
	const send = useCaptureMobileMemory();
	useEffect(() => {
		captureQueue.setSender(async (input) => {
			const captured = await send(input);
			return { id: captured.id };
		});
		return () => {
			captureQueue.setSender(null);
		};
	}, [send]);
}

/**
 * Generates a UUID v4 for a new capture. Uses crypto.randomUUID when
 * available (Hermes on modern RN), falls back to a Math.random v4.
 */
export function newClientCaptureId(): string {
	const cryptoLike = (globalThis as any).crypto;
	if (cryptoLike && typeof cryptoLike.randomUUID === "function") {
		return cryptoLike.randomUUID() as string;
	}
	return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
		const r = Math.floor(Math.random() * 16);
		const v = c === "x" ? r : (r & 0x3) | 0x8;
		return v.toString(16);
	});
}
