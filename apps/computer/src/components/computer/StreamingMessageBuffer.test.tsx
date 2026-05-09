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

  it("renders partial Markdown mid-stream without throwing", () => {
    expect(() =>
      render(
        <StreamingMessageBuffer
          chunks={[
            { seq: 1, text: "| col1 | col2 |\n|---|---|\n| a | " },
          ]}
        />,
      ),
    ).not.toThrow();
    expect(screen.getByLabelText("Computer is typing")).toBeTruthy();
  });
});
