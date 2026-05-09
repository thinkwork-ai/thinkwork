import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { StreamingMessageBuffer } from "./StreamingMessageBuffer";

afterEach(cleanup);

describe("StreamingMessageBuffer", () => {
  it("renders concatenated assistant chunks with an active typing indicator", () => {
    render(
      <StreamingMessageBuffer
        chunks={[
          { seq: 1, text: "Hello" },
          { seq: 2, text: " world" },
        ]}
      />,
    );

    expect(screen.getByText("Hello world")).toBeTruthy();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });

  it("parses Markdown in streamed chunks", () => {
    render(
      <StreamingMessageBuffer
        chunks={[
          { seq: 1, text: "**Bold** and " },
          { seq: 2, text: "[link](https://example.com)" },
        ]}
      />,
    );

    expect(screen.getByText("Bold")).toBeTruthy();
    expect(screen.getByText("link")).toBeTruthy();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });

  it("uses the same tightened prose density modifiers as persisted messages", () => {
    // U1: streaming buffer must visually match the persisted body so the
    // cursor flip from streaming to durable copy doesn't visibly reflow.
    const { container } = render(
      <StreamingMessageBuffer chunks={[{ seq: 1, text: "Hello" }]} />,
    );
    const article = container.querySelector("article.prose");
    expect(article).not.toBeNull();
    const cls = article!.className;
    for (const token of [
      "prose-sm",
      "text-sm",
      "leading-6",
      "prose-p:my-1.5",
      "prose-ul:my-1.5",
      "prose-ol:my-1.5",
      "prose-li:my-0",
      "prose-headings:mt-3",
      "prose-headings:mb-1.5",
    ]) {
      expect(cls).toContain(token);
    }
    expect(cls).not.toContain("leading-8");
    expect(cls).not.toContain("text-[1.05rem]");
    expect(cls).not.toContain("prose-p:my-0");
    expect(cls).not.toContain("prose-p:my-2");
  });

  it("renders partial Markdown mid-stream without throwing", () => {
    expect(() =>
      render(
        <StreamingMessageBuffer
          chunks={[{ seq: 1, text: "| col1 | col2 |\n|---|---|\n| a | " }]}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });
});
