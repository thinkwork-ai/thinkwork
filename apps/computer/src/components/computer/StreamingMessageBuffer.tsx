import type { ComputerThreadChunk } from "@/lib/use-computer-thread-chunks";

interface StreamingMessageBufferProps {
  chunks: ComputerThreadChunk[];
}

export function StreamingMessageBuffer({ chunks }: StreamingMessageBufferProps) {
  if (chunks.length === 0) return null;
  const text = chunks.map((chunk) => chunk.text).join("");

  return (
    <article className="grid gap-3" aria-label="Streaming assistant response">
      <div className="rounded-lg border border-border/70 bg-background/70 px-4 py-3 text-sm leading-6">
        <span>{text}</span>
        <span
          aria-label="Computer is typing"
          className="ml-1 inline-block h-2 w-2 animate-pulse rounded-full bg-muted-foreground"
        />
      </div>
    </article>
  );
}
