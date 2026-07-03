import type { ReactNode } from "react";
import { fireEvent, render, screen } from "@testing-library/react";
import {
  JSONUIProvider,
  Renderer,
  type ComponentRenderer,
} from "@json-render/react";
import { describe, expect, it, vi } from "vitest";

import {
  threadJsonRenderPrimitiveComponents,
  threadJsonRenderPrimitiveRegistry,
} from "../catalog";

const fallback: ComponentRenderer = ({ element }) => (
  <p role="alert">Unsupported: {element.type}</p>
);

function renderSpec(spec: unknown) {
  render(
    <JSONUIProvider registry={threadJsonRenderPrimitiveRegistry}>
      <Renderer
        fallback={fallback}
        registry={threadJsonRenderPrimitiveRegistry}
        spec={spec as never}
      />
    </JSONUIProvider>,
  );
}

describe("owned Base UI primitive components", () => {
  it("emits the Button press event on click through the registry", () => {
    // The registry wraps each owned component fn so it receives json-render's
    // 0.19 component context ({ element, emit, on, bindings, loading }). Drive
    // that context directly to prove the owned Button forwards a click to
    // emit("press") — the event the renderer resolves to an `on.press` binding.
    const emit = vi.fn();
    const on = () => ({
      emit: () => undefined,
      shouldPreventDefault: false,
      bound: false,
    });
    const RegistryButton = threadJsonRenderPrimitiveRegistry.Button as (
      ctx: unknown,
    ) => ReactNode;

    render(
      <>
        {RegistryButton({
          element: {
            type: "Button",
            props: { label: "Approve", variant: "primary", disabled: false },
          },
          emit,
          on,
        })}
      </>,
    );

    fireEvent.click(screen.getByRole("button", { name: "Approve" }));
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit).toHaveBeenCalledWith("press");
  });

  it("exposes an owned component for every catalog primitive name", () => {
    // Sanity: the owned map covers the full primitive set (no shadcn holdover).
    expect(
      Object.keys(threadJsonRenderPrimitiveComponents).length,
    ).toBeGreaterThanOrEqual(30);
    expect(threadJsonRenderPrimitiveComponents.Button).toBeTypeOf("function");
  });

  it("renders a Card > Stack > Heading/Text tree through the registry", () => {
    renderSpec({
      root: "card",
      elements: {
        card: {
          type: "Card",
          props: {
            title: "Overview",
            description: "Summary",
            maxWidth: null,
            centered: false,
            className: null,
          },
          children: ["stack"],
        },
        stack: {
          type: "Stack",
          props: {
            direction: "vertical",
            gap: "sm",
            align: null,
            justify: null,
            className: null,
          },
          children: ["heading", "text"],
        },
        heading: {
          type: "Heading",
          props: { text: "Pipeline health", level: "h3" },
          children: [],
        },
        text: {
          type: "Text",
          props: { text: "All checks are ready.", variant: "body" },
          children: [],
        },
      },
    });

    expect(screen.getByText("Overview")).toBeTruthy();
    expect(
      screen.getByRole("heading", { name: "Pipeline health" }),
    ).toBeTruthy();
    expect(screen.getByText("All checks are ready.")).toBeTruthy();
  });
});
