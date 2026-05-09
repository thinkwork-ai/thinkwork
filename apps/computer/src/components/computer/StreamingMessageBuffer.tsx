import { Streamdown } from "streamdown";
import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

interface StreamingMessageBufferProps {
  chunks: ComputerThreadChunk[];
}

export function StreamingMessageBuffer({
  chunks,
}: StreamingMessageBufferProps) {
  if (chunks.length === 0) return null;
  const text = chunks.map((chunk) => chunk.text).join("");

  return (
    <article
      className="prose prose-sm prose-invert max-w-none text-sm leading-6 text-foreground prose-p:my-1.5 prose-ul:my-1.5 prose-ol:my-1.5 prose-li:my-0 prose-headings:mt-3 prose-headings:mb-1.5 prose-headings:font-semibold prose-strong:font-semibold prose-hr:my-3"
      aria-label="Streaming assistant response"
    >
      <Streamdown>{text}</Streamdown>
      <span
        aria-label="Computer is typing"
        className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground align-middle"
      />
    </article>
  );
}
