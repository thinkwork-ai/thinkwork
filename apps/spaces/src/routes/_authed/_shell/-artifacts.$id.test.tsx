import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { AppletMount, AppletRouteContent } from "./artifacts.$id";

vi.mock("urql", () => ({
  gql: (strings: TemplateStringsArray) => strings.join(""),
  useQuery: vi.fn(),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

const reexecuteAppletQuery = vi.fn();

function appletPayload({
  source = "export default function App() { return <main>Hello</main>; }",
  version = 1,
  metadata = { prompt: "hello" },
}: {
  source?: string;
  version?: number;
  metadata?: Record<string, unknown>;
} = {}) {
  return {
    source,
    files: {
      "App.tsx": source,
    },
    metadata,
    applet: {
      appId: "33333333-3333-4333-8333-333333333333",
      name: "Hello applet",
      version,
      generatedAt: "2026-05-09T12:00:00Z",
    },
  };
}

beforeEach(() => {
  reexecuteAppletQuery.mockReset();
  vi.mocked(useQuery).mockReturnValue([
    {
      data: {
        applet: appletPayload(),
      },
      fetching: false,
      stale: false,
      hasNext: false,
    },
    reexecuteAppletQuery,
  ]);
});

afterEach(() => {
  cleanup();
  window.sessionStorage.clear();
  vi.clearAllMocks();
});

describe("AppletRouteContent", () => {
  it("fetches and mounts a live applet through the iframe substrate", async () => {
    render(<AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />);

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { appId: "33333333-3333-4333-8333-333333333333" },
      }),
    );
    expect(await screen.findByTestId("applet-iframe-host")).toBeTruthy();
  });

  it("keeps the mounted version stable until the newer-version banner is reloaded", async () => {
    const { rerender } = render(
      <AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />,
    );

    await screen.findByTestId("applet-iframe-host");

    vi.mocked(useQuery).mockReturnValue([
      {
        data: {
          applet: appletPayload({
            source:
              "export default function App() { return <main>Updated</main>; }",
            version: 2,
          }),
        },
        fetching: false,
        stale: false,
        hasNext: false,
      },
      reexecuteAppletQuery,
    ]);

    rerender(
      <AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />,
    );

    expect(
      await screen.findByText("A newer version of this artifact is available."),
    ).toBeTruthy();
  });

  it("renders not found when the applet query returns null", () => {
    vi.mocked(useQuery).mockReturnValue([
      {
        data: { applet: null },
        fetching: false,
        stale: false,
        hasNext: false,
      },
      reexecuteAppletQuery,
    ]);

    render(<AppletRouteContent appId="missing" />);

    expect(screen.getByText("Artifact not found.")).toBeTruthy();
  });

  it("default production render takes the iframe substrate path", async () => {
    render(<AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />);

    const host = await screen.findByTestId("applet-iframe-host");
    expect(host).toBeTruthy();
  });

  it("uses browser history for the artifact back button with /artifacts as fallback", () => {
    render(<AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />);

    expect(usePageHeaderActions).toHaveBeenLastCalledWith(
      expect.objectContaining({
        backBehavior: "history",
        backHref: "/artifacts",
      }),
    );
  });

  it("renders full-route content through the generated app artifact shell without duplicate visible chrome", async () => {
    render(<AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />);

    await screen.findByTestId("applet-iframe-host");
    expect(
      screen
        .getByTestId("app-artifact-split-shell")
        .querySelector("[data-generated-app-artifact]"),
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("app-artifact-split-shell")
        .querySelector('[data-runtime-mode="sandboxedGenerated"]'),
    ).toBeTruthy();
    expect(screen.queryByText("Hello applet")).toBeNull();
  });

  it("ignores artifact metadata that claims the trusted native runtime", async () => {
    vi.mocked(useQuery).mockReturnValue([
      {
        data: {
          applet: appletPayload({
            metadata: { prompt: "hello", runtimeMode: "nativeTrusted" },
          }),
        },
        fetching: false,
        stale: false,
        hasNext: false,
      },
      reexecuteAppletQuery,
    ]);

    render(<AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />);

    await screen.findByTestId("applet-iframe-host");
    const shell = screen.getByTestId("app-artifact-split-shell");
    expect(
      shell.querySelector('[data-runtime-mode="sandboxedGenerated"]'),
    ).toBeTruthy();
    expect(
      shell.querySelector('[data-runtime-mode="nativeTrusted"]'),
    ).toBeNull();
  });
});

describe("AppletMount", () => {
  it("always mounts through the iframe host", async () => {
    render(
      <AppletMount
        appId="app-1"
        instanceId="instance-1"
        source="export default function App() { return null; }"
        version={1}
      />,
    );

    expect(await screen.findByTestId("applet-iframe-host")).toBeTruthy();
  });
});
