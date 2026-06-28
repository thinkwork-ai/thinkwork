import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { ThemeProvider, useTheme } from "@thinkwork/ui";
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  MCP_APP_HOST_CONTEXT_CHANGED_METHOD,
  MCP_APP_INITIALIZE_METHOD,
  MCP_APP_INITIALIZED_METHOD,
} from "./mcp-app-frame-bridge";
import { McpAppFrame } from "./McpAppFrame";

afterEach(() => {
  cleanup();
  document.documentElement.removeAttribute("style");
  document.documentElement.classList.remove("dark", "dark-blue");
  document.documentElement.removeAttribute("data-theme");
  localStorage.clear();
});

function renderFrame() {
  document.documentElement.style.setProperty("--background", "#101010");
  document.documentElement.style.setProperty("--foreground", "#f7f7f7");
  localStorage.setItem("thinkwork.theme", "dark-blue");
  const view = render(
    <ThemeProvider>
      <McpAppFrame
        html="<!doctype html><title>Dispatch</title><main>map</main>"
        title="Dispatch"
        uri="ui://dispatch/optimization"
      />
    </ThemeProvider>,
  );
  const iframe = view.container.querySelector("iframe");
  expect(iframe?.contentWindow).toBeTruthy();
  const postMessage = vi.fn();
  Object.defineProperty(iframe!.contentWindow!, "postMessage", {
    configurable: true,
    value: postMessage,
  });
  return { ...view, iframe: iframe!, postMessage };
}

describe("McpAppFrame", () => {
  it("preserves the existing visible iframe contract", () => {
    const { iframe } = renderFrame();

    expect(screen.getByTestId("mcp-app-frame")).toBeTruthy();
    expect(screen.getByText("Dispatch")).toBeTruthy();
    expect(screen.getByText("ui://dispatch/optimization")).toBeTruthy();
    expect(iframe.getAttribute("srcdoc")).toContain("<main>map</main>");
    expect(iframe.getAttribute("sandbox")).toContain("allow-scripts");
    expect(iframe.getAttribute("sandbox")).not.toContain("allow-same-origin");
  });

  it("responds to spec ui/initialize with dark-blue mapped to dark", async () => {
    const { iframe, postMessage } = renderFrame();

    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe.contentWindow,
        data: {
          jsonrpc: "2.0",
          id: "init-1",
          method: MCP_APP_INITIALIZE_METHOD,
          params: { appCapabilities: {} },
        },
      }),
    );

    await waitFor(() => expect(postMessage).toHaveBeenCalled());
    expect(postMessage).toHaveBeenCalledWith(
      expect.objectContaining({
        id: "init-1",
        result: expect.objectContaining({
          hostContext: expect.objectContaining({
            theme: "dark",
            styles: expect.objectContaining({
              variables: expect.objectContaining({
                "--color-background-primary": "#101010",
              }),
            }),
          }),
        }),
      }),
      "*",
    );
  });

  it("sends host-context-changed after the View is initialized", async () => {
    document.documentElement.style.setProperty("--background", "#101010");
    localStorage.setItem("thinkwork.theme", "dark-blue");
    const view = render(
      <ThemeProvider>
        <ThemeHarness />
      </ThemeProvider>,
    );
    const iframe = view.container.querySelector("iframe");
    expect(iframe?.contentWindow).toBeTruthy();
    const postMessage = vi.fn();
    Object.defineProperty(iframe!.contentWindow!, "postMessage", {
      configurable: true,
      value: postMessage,
    });

    window.dispatchEvent(
      new MessageEvent("message", {
        source: iframe!.contentWindow,
        data: { method: MCP_APP_INITIALIZED_METHOD },
      }),
    );

    fireEvent.click(screen.getByRole("button", { name: "Use light" }));

    await waitFor(() =>
      expect(
        postMessage.mock.calls.some(
          ([message]) =>
            message?.method === MCP_APP_HOST_CONTEXT_CHANGED_METHOD,
        ),
      ).toBe(true),
    );
  });
});

function ThemeHarness() {
  const { setTheme } = useTheme();
  return (
    <>
      <button
        type="button"
        onClick={() => {
          document.documentElement.style.setProperty("--background", "#ffffff");
          setTheme("light");
        }}
      >
        Use light
      </button>
      <McpAppFrame
        html="<!doctype html><title>Dispatch</title><main>map</main>"
        title="Dispatch"
      />
    </>
  );
}
