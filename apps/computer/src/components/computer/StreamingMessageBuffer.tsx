import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

interface StreamingMessageBufferProps {
  chunks: ComputerThreadChunk[];
}

export function StreamingMessageBuffer({ chunks }: StreamingMessageBufferProps) {
  if (chunks.length === 0) return null;
  const text = chunks.map((chunk) => chunk.text).join("");

  return (
    <article
      className="prose prose-invert max-w-none text-[1.05rem] leading-8 text-foreground prose-p:my-0"
      aria-label="Streaming assistant response"
    >
      <p>
        <span>{text}</span>
        <span
          aria-label="Computer is typing"
          className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground align-middle"
        />
      </p>
    </article>
  );
}
