/**
 * Transport-adapter tests cover the single-submit invariant (P0 release
 * gate per plan U4 / contract v1) and the chunk → ReadableStream flow.
 *
 * Mocks the urql client: we test the adapter, not urql.
 */

import { afterEach, describe, expect, it, vi } from "vitest";
import {
	createAppSyncChatTransport,
	TransportMutationError,
} from "./use-chat-appsync-transport";
import type { UIMessage } from "./ui-message-types";

interface FakeSubscriptionEvent {
	data?: { onComputerThreadChunk?: unknown };
}

class FakeSource {
	private listeners: Array<(event: FakeSubscriptionEvent) => void> = [];
	private closed = false;
	private seq = 0;
	subscribe(listener: (event: FakeSubscriptionEvent) => void) {
		this.listeners.push(listener);
		return {
			unsubscribe: () => {
				this.closed = true;
				this.listeners = [];
			},
		};
	}
	/**
	 * Emit one AppSync subscription event whose `chunk` field carries an
	 * AWSJSON-encoded payload — this mirrors the wire shape from
	 * `ComputerThreadChunkEvent { threadId, chunk: AWSJSON, seq,
	 * publishedAt }`.
	 */
	emit(chunkPayload: string) {
		if (this.closed) return;
		this.seq += 1;
		const event = {
			data: {
				onComputerThreadChunk: {
					threadId: "thread-1",
					chunk: chunkPayload,
					seq: this.seq,
					publishedAt: new Date().toISOString(),
				},
			},
		};
		for (const listener of this.listeners) {
			listener(event);
		}
	}
	get isClosed() {
		return this.closed;
	}
}

interface FakeMutationResult {
	data?: unknown;
	error?: Error;
}

function buildFakeUrqlClient(opts: {
	mutationResult?: FakeMutationResult;
	mutationThrows?: Error;
}) {
	const source = new FakeSource();
	const mutation = vi
		.fn()
		.mockImplementation(
			() =>
				({
					toPromise: vi.fn().mockImplementation(async () => {
						if (opts.mutationThrows) throw opts.mutationThrows;
						return opts.mutationResult ?? { data: { sendMessage: { id: "m1" } } };
					}),
				}) as unknown,
		);
	const subscription = vi.fn().mockImplementation(() => source);
	return { mutation, subscription, source };
}

function buildUserMessage(text: string): UIMessage {
	return {
		id: "u1",
		role: "user",
		parts: [{ type: "text", text }],
	} as unknown as UIMessage;
}

async function readAll<T>(stream: ReadableStream<T>): Promise<T[]> {
	const reader = stream.getReader();
	const chunks: T[] = [];
	while (true) {
		const { value, done } = await reader.read();
		if (done) break;
		if (value !== undefined) chunks.push(value);
	}
	return chunks;
}

afterEach(() => {
	vi.restoreAllMocks();
});

describe("createAppSyncChatTransport", () => {
	describe("single-submit invariant (P0)", () => {
		it("calls the turn-start mutation exactly once per sendMessages submit-message", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("hello")],
				abortSignal: undefined,
			});

			expect(mutation).toHaveBeenCalledTimes(1);
			expect(transport.mutationCallCount).toBe(1);
			expect(subscription).toHaveBeenCalledTimes(1);

			// Drive a finish to close the stream cleanly so the test can assert
			// status transitions without leaking.
			source.emit(JSON.stringify({ type: "finish" }));
			const chunks = await readAll(stream);
			expect(chunks).toHaveLength(1);
			expect(chunks[0]).toMatchObject({ type: "finish" });
			expect(transport.transportStatus).toBe("closed");
		});

		it("calls the turn-start mutation exactly once per regenerate-message", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			const stream = await transport.sendMessages({
				trigger: "regenerate-message",
				chatId: "thread-1",
				messageId: "msg-2",
				messages: [buildUserMessage("redo it")],
				abortSignal: undefined,
			});

			expect(mutation).toHaveBeenCalledTimes(1);
			expect(transport.mutationCallCount).toBe(1);

			// Confirm the mutation was called with regenerate metadata.
			const variables = mutation.mock.calls[0][1] as {
				input: { metadata?: unknown };
			};
			expect(variables.input.metadata).toMatchObject({
				trigger: "regenerate-message",
				regenerateOf: "msg-2",
			});

			source.emit(JSON.stringify({ type: "finish" }));
			await readAll(stream);
		});

		it("refuses to issue a turn-start with an empty user prompt on submit-message", async () => {
			const { mutation, subscription } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			await expect(
				transport.sendMessages({
					trigger: "submit-message",
					chatId: "thread-1",
					messageId: undefined,
					messages: [],
					abortSignal: undefined,
				}),
			).rejects.toThrow(/empty user prompt/);

			expect(mutation).not.toHaveBeenCalled();
			expect(transport.mutationCallCount).toBe(0);
			expect(transport.transportStatus).toBe("errored");
		});
	});

	describe("subscription → ReadableStream<UIMessageChunk>", () => {
		it("forwards a sequence of typed chunks in arrival order", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("hi")],
				abortSignal: undefined,
			});

			source.emit(JSON.stringify({ type: "text-start", id: "p1" }));
			source.emit(
				JSON.stringify({
					type: "text-delta",
					id: "p1",
					delta: "Hello",
				}),
			);
			source.emit(
				JSON.stringify({
					type: "text-delta",
					id: "p1",
					delta: " world",
				}),
			);
			source.emit(JSON.stringify({ type: "text-end", id: "p1" }));
			source.emit(JSON.stringify({ type: "finish" }));

			const chunks = await readAll(stream);
			expect(chunks).toHaveLength(5);
			expect(chunks.map((c) => c.type)).toEqual([
				"text-start",
				"text-delta",
				"text-delta",
				"text-end",
				"finish",
			]);
			expect(transport.transportStatus).toBe("closed");
		});

		it("forwards interleaved text + tool-renderFragment parts (covers AE3 contract)", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("draw me a chart")],
				abortSignal: undefined,
			});

			source.emit(JSON.stringify({ type: "text-start", id: "p1" }));
			source.emit(
				JSON.stringify({
					type: "text-delta",
					id: "p1",
					delta: "Sure: ",
				}),
			);
			source.emit(
				JSON.stringify({
					type: "tool-input-available",
					toolCallId: "t1",
					toolName: "renderFragment",
					input: { tsx: "<App />", version: "0.1.0" },
				}),
			);
			source.emit(
				JSON.stringify({
					type: "tool-output-available",
					toolCallId: "t1",
					output: { rendered: true, channelId: "abc" },
				}),
			);
			source.emit(JSON.stringify({ type: "text-end", id: "p1" }));
			source.emit(JSON.stringify({ type: "finish" }));

			const chunks = await readAll(stream);
			expect(chunks.map((c) => c.type)).toEqual([
				"text-start",
				"text-delta",
				"tool-input-available",
				"tool-output-available",
				"text-end",
				"finish",
			]);
		});

		it("drops malformed chunks via onChunkDrop without erroring the stream", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const drops: unknown[] = [];
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
				onChunkDrop: (parsed) => drops.push(parsed),
			});

			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("hi")],
				abortSignal: undefined,
			});

			source.emit("not json");
			source.emit(JSON.stringify({ type: "future-shaped" }));
			source.emit(JSON.stringify({ type: "text-start", id: "p1" }));
			source.emit(JSON.stringify({ type: "finish" }));

			const chunks = await readAll(stream);
			expect(chunks.map((c) => c.type)).toEqual(["text-start", "finish"]);
			expect(drops).toHaveLength(2);
		});

		it("legacy {text} envelopes are routed via onLegacyChunk and never enqueued as protocol", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const legacy: string[] = [];
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
				onLegacyChunk: (text) => legacy.push(text),
			});

			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("hi")],
				abortSignal: undefined,
			});

			source.emit(JSON.stringify({ text: "still on legacy" }));
			source.emit(JSON.stringify({ type: "finish" }));

			const chunks = await readAll(stream);
			expect(legacy).toEqual(["still on legacy"]);
			expect(chunks.map((c) => c.type)).toEqual(["finish"]);
		});

		it("abortSignal aborts the subscription and closes the stream", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			const controller = new AbortController();
			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("hi")],
				abortSignal: controller.signal,
			});

			source.emit(JSON.stringify({ type: "text-start", id: "p1" }));
			controller.abort();

			const chunks = await readAll(stream);
			expect(chunks).toHaveLength(1);
			expect(source.isClosed).toBe(true);
			expect(transport.transportStatus).toBe("closed");
		});

		it("error chunk transitions transportStatus to errored without closing the stream", async () => {
			const { mutation, subscription, source } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			const stream = await transport.sendMessages({
				trigger: "submit-message",
				chatId: "thread-1",
				messageId: undefined,
				messages: [buildUserMessage("hi")],
				abortSignal: undefined,
			});

			source.emit(
				JSON.stringify({ type: "error", errorText: "rate limited" }),
			);
			expect(transport.transportStatus).toBe("errored");
			source.emit(JSON.stringify({ type: "finish" }));
			await readAll(stream);
			expect(transport.transportStatus).toBe("closed");
		});
	});

	describe("mutation error handling", () => {
		it("urql mutation result.error wraps in TransportMutationError", async () => {
			const { mutation, subscription } = buildFakeUrqlClient({
				mutationResult: { error: new Error("graphql rejected") },
			});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			await expect(
				transport.sendMessages({
					trigger: "submit-message",
					chatId: "thread-1",
					messageId: undefined,
					messages: [buildUserMessage("hi")],
					abortSignal: undefined,
				}),
			).rejects.toBeInstanceOf(TransportMutationError);
			expect(transport.transportStatus).toBe("errored");
		});

		it("mutation throw wraps in TransportMutationError", async () => {
			const { mutation, subscription } = buildFakeUrqlClient({
				mutationThrows: new Error("network down"),
			});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});

			await expect(
				transport.sendMessages({
					trigger: "submit-message",
					chatId: "thread-1",
					messageId: undefined,
					messages: [buildUserMessage("hi")],
					abortSignal: undefined,
				}),
			).rejects.toBeInstanceOf(TransportMutationError);
		});
	});

	describe("reconnectToStream", () => {
		it("returns null in v1 — no server-side replay buffer yet", async () => {
			const { mutation, subscription } = buildFakeUrqlClient({});
			const transport = createAppSyncChatTransport({
				urqlClient: { mutation, subscription },
				threadId: "thread-1",
			});
			await expect(
				transport.reconnectToStream({ chatId: "thread-1" }),
			).resolves.toBeNull();
		});
	});
});
