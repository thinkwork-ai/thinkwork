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
});
