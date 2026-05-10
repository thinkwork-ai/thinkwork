import { Response } from "@/components/ai-elements/response";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

interface StreamingMessageBufferProps {
	chunks: ComputerThreadChunk[];
}

/**
 * Plan-012 U8 / contract v1 §AE4: assistant streaming markdown renders
 * via <Response>, not raw <Streamdown>. The legacy `chunks.map(c =>
 * c.text).join("")` flatten stays in this component as the fallback for
 * pre-typed `{text}` envelopes — once Phase 2 of plan-012 fully ships
 * the cleanup follow-up retires this component, replaced by the typed
 * UIMessageStreamState path in TaskThreadView.
 */
export function StreamingMessageBuffer({
	chunks,
}: StreamingMessageBufferProps) {
	if (chunks.length === 0) return null;
	const text = chunks.map((chunk) => chunk.text).join("");

	return (
		<article aria-label="Streaming assistant response">
			<Response className="prose-invert text-sm leading-5 text-foreground prose-p:my-1.5 prose-p:leading-5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-li:leading-5 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-3">
				{text}
			</Response>
			<span
				aria-label="Computer is typing"
				className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground align-middle"
			/>
		</article>
	);
}
