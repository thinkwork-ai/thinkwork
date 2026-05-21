import * as React from "react";
import { vi } from "vitest";

vi.mock("@tanstack/react-router", async (importOriginal) => {
  const actual =
    await importOriginal<typeof import("@tanstack/react-router")>();

  type MockLinkProps = {
    children?: React.ReactNode;
    params?: unknown;
    search?: unknown;
    to?: unknown;
    [key: string]: unknown;
  };

  const Link = React.forwardRef<HTMLAnchorElement, MockLinkProps>(
    function LinkMock({ to, params, search, children, ...props }, ref) {
      const renderedChildren = children as React.ReactNode;
      return React.createElement(
        "a",
        {
          ...props,
          ref,
          href: buildMockHref(to, params, search),
        },
        renderedChildren,
      );
    },
  );

  return { ...actual, Link };
});

function buildMockHref(to: unknown, params: unknown, search: unknown) {
  let href = typeof to === "string" ? to : "#";
  if (params && typeof params === "object") {
    for (const [key, value] of Object.entries(params)) {
      href = href.replace(`$${key}`, encodeURIComponent(String(value)));
    }
  }
  if (search && typeof search === "object") {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(search)) {
      if (value != null) query.set(key, String(value));
    }
    const serialized = query.toString();
    if (serialized) href = `${href}?${serialized}`;
  }
  return href;
}

class ResizeObserverStub {
  private callback: ResizeObserverCallback;

  constructor(callback: ResizeObserverCallback) {
    this.callback = callback;
  }

  observe(target: Element) {
    this.callback(
      [
        {
          target,
          contentRect: {
            x: 0,
            y: 0,
            width: 800,
            height: 320,
            top: 0,
            left: 0,
            right: 800,
            bottom: 320,
            toJSON: () => ({}),
          },
        } as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }

  unobserve() {}
  disconnect() {}
}

globalThis.ResizeObserver = ResizeObserverStub;
