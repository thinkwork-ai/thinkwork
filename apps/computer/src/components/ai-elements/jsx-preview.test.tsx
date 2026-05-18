import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  JSXPreview,
  JSXPreviewContent,
  JSXPreviewError,
} from "@/components/ai-elements/jsx-preview";

afterEach(cleanup);

const previewComponents = {
  Card: ({ children }: { children?: ReactNode }) => (
    <section data-testid="preview-card">{children}</section>
  ),
  Button: ({ children }: { children?: ReactNode }) => (
    <button type="button">{children}</button>
  ),
};

describe("JSXPreview", () => {
  it("renders approved injected components", () => {
    render(
      <JSXPreview
        components={previewComponents}
        jsx="<Card><Button>Save draft</Button></Card>"
      />,
    );

    expect(screen.getByTestId("preview-card")).toBeTruthy();
    expect(screen.getByRole("button", { name: /save draft/i })).toBeTruthy();
  });

  it("auto-completes open tags while streaming", () => {
    render(
      <JSXPreview
        components={previewComponents}
        isStreaming
        jsx="<Card><Button>Streaming draft"
      >
        <JSXPreviewContent />
        <JSXPreviewError />
      </JSXPreview>,
    );

    expect(
      screen.getByRole("button", { name: /streaming draft/i }),
    ).toBeTruthy();
    expect(screen.queryByRole("alert")).toBeNull();
  });

  it("surfaces parse errors", async () => {
    const onError = vi.fn();

    render(
      <JSXPreview
        components={previewComponents}
        jsx="<Card><Button>Broken</Card>"
        onError={onError}
      />,
    );

    expect(await screen.findByRole("alert")).toBeTruthy();
    expect(onError).toHaveBeenCalled();
  });
});
