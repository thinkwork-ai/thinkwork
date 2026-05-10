import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

vi.mock("@/applets/host-registry", () => ({
  loadAppletHostExternals: vi.fn(async () => undefined),
}));

vi.mock("@/applets/host-applet-api", () => ({
  registerAppletRefreshHandler: vi.fn(),
}));

vi.mock("@/applets/transform/transform", () => ({
  transformApplet: vi.fn(async () => ({
    ok: true,
    compiledModuleUrl: "stub://applet/main.js",
    cacheKey: "stub-cache-key",
  })),
}));

import { InlineAppletEmbed } from "./InlineAppletEmbed";

const useQueryMock = vi.mocked(useQuery);

const stubReexecute = vi.fn();

function mockUseQuery(
  result: Partial<{
    data: unknown;
    fetching: boolean;
    error: Error | undefined;
  }>,
) {
  useQueryMock.mockReturnValue([
    {
      data: result.data,
      fetching: Boolean(result.fetching),
      error: result.error,
      stale: false,
      operation: undefined,
    },
    stubReexecute,
  ] as unknown as ReturnType<typeof useQuery>);
}

beforeEach(() => {
  useQueryMock.mockReset();
  stubReexecute.mockReset();
  window.sessionStorage.clear();
});

afterEach(cleanup);

describe("InlineAppletEmbed", () => {
  it("shows a loading state while the applet query is in flight", () => {
    mockUseQuery({ fetching: true });

    render(<InlineAppletEmbed appId="app_loading" />);

    expect(screen.getByText(/loading artifact/i)).toBeTruthy();
  });

  it("surfaces the query error when applet load fails", () => {
    mockUseQuery({ error: new Error("network down") });

    render(<InlineAppletEmbed appId="app_error" />);

    expect(screen.getByText(/network down/i)).toBeTruthy();
  });

  it("warns when the artifact has no mountable source", () => {
    mockUseQuery({
      data: {
        applet: {
          source: null,
          files: null,
          applet: { appId: "app_no_source", version: 1, name: "Empty" },
        },
      },
    });

    render(<InlineAppletEmbed appId="app_no_source" />);

    expect(
      screen.getByText(/does not include a source file/i),
    ).toBeTruthy();
  });

  it("mounts the applet inside a sized embed container", async () => {
    mockUseQuery({
      data: {
        applet: {
          source: "export default function App() { return null; }",
          files: null,
          applet: {
            appId: "app_ok",
            version: 1,
            name: "Opportunity dashboard",
          },
        },
      },
    });

    function StubAppletModule() {
      return <div data-testid="stub-applet-body">applet rendered</div>;
    }

    const loadModule = vi.fn(async () => ({ default: StubAppletModule }));

    render(
      <InlineAppletEmbed
        appId="app_ok"
        height={320}
        loadModule={loadModule}
      />,
    );

    const embed = await screen.findByTestId("inline-applet-embed");
    expect(embed.getAttribute("style")).toContain("height: 320px");

    await waitFor(() => {
      expect(screen.getByTestId("stub-applet-body")).toBeTruthy();
    });
    expect(loadModule).toHaveBeenCalledWith("stub://applet/main.js");
  });

  it("default production render takes the iframe substrate path (no loadModule prop)", async () => {
    // Plan-012 U11.5: production InlineAppletEmbed must NOT default
    // loadModule to defaultAppletModuleLoader. With no loadModule, the
    // AppletMount routes to IframeAppletMount which appends an iframe
    // host element. Asserts (a) the iframe host testid is present and
    // (b) the legacy transformApplet seam was NOT called.
    const { transformApplet } = await import(
      "@/applets/transform/transform"
    );
    vi.mocked(transformApplet).mockClear();

    mockUseQuery({
      data: {
        applet: {
          source: "export default function App() { return null; }",
          files: null,
          applet: {
            appId: "app_iframe_default",
            version: 1,
            name: "Default",
          },
        },
      },
    });

    render(<InlineAppletEmbed appId="app_iframe_default" />);

    // iframe host element present (rendered by IframeAppletMount).
    const host = await screen.findByTestId("applet-iframe-host");
    expect(host).toBeTruthy();

    // Legacy transform path is NOT exercised — that's the
    // load-bearing assertion that this PR closes the production
    // bypass adversarial review flagged.
    expect(vi.mocked(transformApplet)).not.toHaveBeenCalled();
  });
});
