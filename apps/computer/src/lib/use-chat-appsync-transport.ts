/**
 * Vercel AI SDK `ChatTransport<UIMessage>` adapter that bridges the
 * existing AppSync Computer chunk subscription to `useChat`.
 *
 * Inert scaffold (plan 2026-05-09-012 U4) — exported but no consumer mounts
 * it yet. U8 wires it into `ComputerThreadDetailRoute.tsx`.
 *
 * Contract:
 *   docs/specs/computer-ai-elements-contract-v1.md
 *
 * Sole-owner invariant:
 *   sendMessages is the SOLE caller of `SendMessageMutation` (the existing
 *   turn-start mutation chain). Composers MUST call only
 *   `useChat().sendMessage()` and never invoke `SendMessageMutation` directly.
 *   Double-submit is a P0 release gate.
 */

import type { Client } from "@urql/core";
import type { ChatTransport } from "ai";
import {
	ComputerThreadChunkSubscription,
	SendMessageMutation,
} from "./graphql-queries";
import {
	parseChunkPayload,
	__PROTOCOL_TYPE_SETS,
} from "./ui-message-chunk-parser";
import type {
	ParsedChunk,
	UIMessage,
	UIMessageChunk,
} from "./ui-message-types";

export type TransportStatus =
	| "idle"
	| "streaming"
	| "closed"
	| "errored";

export interface CreateAppSyncChatTransportOptions {
	urqlClient: Pick<Client, "mutation" | "subscription">;
	threadId: string;
	tenantId?: string | null;
	/**
	 * Override the legacy-fallback handler for chunks that arrive in the
	 * pre-typed `{text}` envelope (non-Computer agent traffic, or pre-U6
	 * Computer threads). The transport drops them by default; consumers that
	 * still need to render legacy text can opt in here.
	 */
	onLegacyChunk?: (text: string) => void;
	/**
	 * Per `feedback_smoke_pin_dispatch_status_in_response`: the transport
	 * surfaces drop / error events to a smoke pin so deploys can detect
	 * silent regressions.
	 */
	onChunkDrop?: (parsed: Extract<ParsedChunk, { kind: "drop" }>) => void;
	/**
	 * Hook for the `useChat` retry path. Defaults to the AppSync flow above;
	 * exposed here so tests can simulate without hitting urql.
	 */
	now?: () => number;
}

export interface AppSyncChatTransport extends ChatTransport<UIMessage> {
	/**
	 * Smoke pin per `feedback_smoke_pin_dispatch_status_in_response`. Tracks
	 * the lifecycle of the currently-active `sendMessages` invocation.
	 */
	readonly transportStatus: TransportStatus;
	/**
	 * Number of times this transport has called the turn-start mutation.
	 * Exposed so the U4 single-submit invariant test can assert exactly one
	 * call per `sendMessages` invocation.
	 */
	readonly mutationCallCount: number;
}

interface SendMessageVariables {
	input: {
		threadId: string;
		role: "USER" | "ASSISTANT" | "SYSTEM" | "TOOL";
		content: string;
		senderType?: string;
		senderId?: string;
		toolCalls?: unknown;
		toolResults?: unknown;
		metadata?: unknown;
	};
}

/**
 * Build a `ChatTransport<UIMessage>` whose `sendMessages` posts to the
 * existing `sendMessage` GraphQL mutation and whose downstream stream is the
 * existing `onComputerThreadChunk` AppSync subscription.
 *
 * The transport does NOT also create the thread — `CreateThread` is the
 * empty-thread composer's responsibility and runs before the user navigates
 * into the thread route. By the time `sendMessages` fires, the thread UUID
 * is the `chatId` passed by `useChat`.
 */
export function createAppSyncChatTransport(
	options: CreateAppSyncChatTransportOptions,
): AppSyncChatTransport {
	const { urqlClient, onLegacyChunk, onChunkDrop } = options;
	let status: TransportStatus = "idle";
	let mutationCallCount = 0;

	function setStatus(next: TransportStatus): void {
		status = next;
	}

	const transport: AppSyncChatTransport = {
		get transportStatus() {
			return status;
		},
		get mutationCallCount() {
			return mutationCallCount;
		},

		async sendMessages(input) {
			const { trigger, chatId, messages, abortSignal } = input;
			setStatus("streaming");

			// Find the most-recent user message for the turn-start payload.
			// `useChat` appends the new user message before calling
			// `sendMessages`; on `regenerate-message` the prompt is the last
			// user message in the array.
			const userMessage = [...messages]
				.reverse()
				.find((m) => m.role === "user");

			const promptText = extractText(userMessage);

			if (trigger === "submit-message" && !promptText) {
				setStatus("errored");
				throw new Error(
					"createAppSyncChatTransport.sendMessages: empty user prompt — refusing to issue an empty turn-start.",
				);
			}

			// Single-submit invariant: exactly one mutation call per
			// sendMessages invocation. Counted before the await so the
			// post-test assertion sees the call even if the network errors.
			mutationCallCount += 1;
			const variables: SendMessageVariables = {
				input: {
					threadId: chatId,
					role: "USER",
					content: promptText ?? "",
					...(trigger === "regenerate-message" && {
						metadata: {
							trigger: "regenerate-message",
							regenerateOf: input.messageId ?? null,
						},
					}),
				},
			};

			let mutationResult;
			try {
				mutationResult = await urqlClient
					.mutation(SendMessageMutation, variables)
					.toPromise();
			} catch (cause) {
				setStatus("errored");
				throw new TransportMutationError(
					"sendMessage mutation rejected",
					{ cause },
				);
			}

			if (mutationResult?.error) {
				setStatus("errored");
				throw new TransportMutationError(
					mutationResult.error.message,
					{ cause: mutationResult.error },
				);
			}

			// Construct a ReadableStream<UIMessageChunk> backed by the AppSync
			// subscription. urql's subscription API hands us a Source we can
			// pipe into a ReadableStream.
			let unsubscribe: (() => void) | null = null;
			const stream = new ReadableStream<UIMessageChunk>({
				start(controller) {
					if (abortSignal?.aborted) {
						setStatus("closed");
						controller.close();
						return;
					}
					const sub = urqlClient.subscription(
						ComputerThreadChunkSubscription,
						{ threadId: chatId },
					);
					const subscription = sub.subscribe((event) => {
						const chunkEvent = event.data?.onComputerThreadChunk;
						if (!chunkEvent) return;
						const parsed = parseChunkPayload(chunkEvent.chunk);
						switch (parsed.kind) {
							case "protocol": {
								controller.enqueue(parsed.chunk);
								if (parsed.chunk.type === "finish") {
									setStatus("closed");
									unsubscribe?.();
									controller.close();
								} else if (parsed.chunk.type === "abort") {
									setStatus("closed");
									unsubscribe?.();
									controller.close();
								} else if (parsed.chunk.type === "error") {
									setStatus("errored");
									// Error chunk does NOT close the stream — useChat
									// surfaces it via status: "error" and the consumer
									// can decide whether to abort. Leave teardown to
									// abortSignal.
								}
								break;
							}
							case "legacy": {
								onLegacyChunk?.(parsed.chunk.text);
								break;
							}
							case "drop": {
								onChunkDrop?.(parsed);
								break;
							}
						}
					});
					unsubscribe = () => subscription.unsubscribe();

					if (abortSignal) {
						abortSignal.addEventListener(
							"abort",
							() => {
								setStatus("closed");
								unsubscribe?.();
								try {
									controller.close();
								} catch {
									/* already closed */
								}
							},
							{ once: true },
						);
					}
				},
				cancel() {
					unsubscribe?.();
					setStatus("closed");
				},
			});

			return stream;
		},

		async reconnectToStream() {
			// v1: page reload during a streaming turn loses the live useChat
			// stream. The persisted message-list query rehydrates the final
			// assistant message once `finish` lands and the writer commits
			// `parts` — see U7's persistence boundary contract.
			return null;
		},
	};

	return transport;
}

export class TransportMutationError extends Error {
	constructor(message: string, options?: { cause?: unknown }) {
		super(message, options);
		this.name = "TransportMutationError";
	}
}

function extractText(message: UIMessage | undefined): string | null {
	if (!message) return null;
	const parts = message.parts ?? [];
	const textParts = parts
		.filter(
			(p): p is Extract<typeof p, { type: "text"; text: string }> =>
				p.type === "text" && typeof (p as { text?: unknown }).text === "string",
		)
		.map((p) => p.text);
	if (textParts.length > 0) return textParts.join("");
	// Fallback: some callers populate `content` on the legacy shape; useChat
	// itself stores text under parts, so this is purely defensive.
	const maybeContent = (message as unknown as { content?: unknown }).content;
	return typeof maybeContent === "string" ? maybeContent : null;
}

/**
 * Re-exported so smoke pins can audit which protocol types the parser
 * accepts at build time.
 */
export const __TRANSPORT_PROTOCOL_COVERAGE = __PROTOCOL_TYPE_SETS;
