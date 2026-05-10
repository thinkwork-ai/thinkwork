/**
 * Typed-part renderer (plan-012 U14).
 *
 * Converts an `AccumulatedPart` from `ui-message-merge.ts` into a JSX
 * element using AI Elements primitives:
 *
 *   - text       → <Response>{text}</Response>
 *   - reasoning  → <Reasoning><ReasoningContent>{text}</ReasoningContent></Reasoning>
 *   - tool-*     → <Tool><ToolHeader/><ToolInput/><ToolOutput/></Tool>
 *   - data-*     → forward-compat warning (no rendering surface yet)
 *   - source-*   → minimal anchor / list item
 *   - file       → minimal link / preview
 *
 * Once the thread surface (TaskThreadView) consumes the typed
 * `streamState.parts` from `useComputerThreadChunks` (the field added
 * in U6), this helper is the single switch point. The existing
 * `actionRowsForMessage` derivation stays for legacy messages with
 * no typed parts; the cleanup follow-up after Phase 2 stability
 * retires it.
 */

import type { ReactNode } from "react";
import {
	Reasoning,
	ReasoningContent,
	ReasoningTrigger,
} from "@/components/ai-elements/reasoning";
import { Response } from "@/components/ai-elements/response";
import {
	Tool,
	ToolContent,
	ToolHeader,
	ToolInput,
	ToolOutput,
} from "@/components/ai-elements/tool";
import type { AccumulatedPart } from "@/lib/ui-message-merge";

export interface RenderTypedPartOptions {
	/** Stable React key prefix (usually the message id). */
	keyPrefix: string;
	/** Index of the part within the message — appended to `keyPrefix`
	 * to form a stable React key. */
	index: number;
}

export function renderTypedPart(
	part: AccumulatedPart,
	{ keyPrefix, index }: RenderTypedPartOptions,
): ReactNode {
	const key = `${keyPrefix}::${index}`;

	switch (part.type) {
		case "text":
			return (
				<Response
					key={key}
					className="prose-invert text-sm leading-5 text-foreground prose-p:my-1.5 prose-p:leading-5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:leading-5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-3"
				>
					{part.text}
				</Response>
			);
		case "reasoning":
			return (
				<Reasoning
					key={key}
					isStreaming={part.state === "streaming"}
					defaultOpen={false}
				>
					<ReasoningTrigger />
					<ReasoningContent>{part.text}</ReasoningContent>
				</Reasoning>
			);
		case "source-url":
			return (
				<a
					key={key}
					href={part.url}
					target="_blank"
					rel="noreferrer"
					className="block text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				>
					{part.title || part.url}
				</a>
			);
		case "source-document":
			return (
				<div key={key} className="text-sm text-muted-foreground">
					{part.title}
					{part.filename ? ` — ${part.filename}` : null}
				</div>
			);
		case "file":
			return (
				<a
					key={key}
					href={part.url}
					target="_blank"
					rel="noreferrer"
					className="block text-sm text-muted-foreground underline-offset-2 hover:text-foreground hover:underline"
				>
					Attached file ({part.mediaType})
				</a>
			);
		default:
			break;
	}

	if (part.type.startsWith("tool-")) {
		const toolPart = part as Extract<
			AccumulatedPart,
			{ type: `tool-${string}` }
		>;
		return (
			<Tool key={key}>
				<ToolHeader type={toolPart.type} state={toolPart.state} />
				<ToolContent>
					<ToolInput input={toolPart.input} />
					<ToolOutput
						errorText={toolPart.errorText}
						output={
							toolPart.output !== undefined ? (
								<pre className="overflow-x-auto whitespace-pre-wrap text-xs">
									{typeof toolPart.output === "string"
										? toolPart.output
										: JSON.stringify(toolPart.output, null, 2)}
								</pre>
							) : null
						}
					/>
				</ToolContent>
			</Tool>
		);
	}

	if (part.type.startsWith("data-")) {
		// Forward-compat: render as a small debug strip so unknown
		// data-${name} parts surface in the UI without crashing.
		return (
			<div
				key={key}
				className="rounded border border-border/50 bg-muted/30 px-2 py-1 text-xs text-muted-foreground"
			>
				{part.type}
			</div>
		);
	}

	return null;
}

/**
 * Render the full sequence of accumulated parts for one assistant
 * message. Returns an array; the caller wraps it in <Message>.
 */
export function renderTypedParts(
	parts: AccumulatedPart[],
	options: { keyPrefix: string },
): ReactNode[] {
	return parts.map((part, index) =>
		renderTypedPart(part, {
			keyPrefix: options.keyPrefix,
			index,
		}),
	);
}
