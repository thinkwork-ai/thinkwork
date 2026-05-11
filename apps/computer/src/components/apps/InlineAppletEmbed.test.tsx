import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";

vi.mock("urql", async (importOriginal) => {
  const actual = await importOriginal<typeof import("urql")>();
  return {
    ...actual,
    useQuery: vi.fn(),
  };
});

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

    expect(screen.getByText(/does not include a source file/i)).toBeTruthy();
  });

  it("mounts the applet inside a fit-content embed container", async () => {
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

    render(<InlineAppletEmbed appId="app_ok" height={320} />);

    const embed = await screen.findByTestId("inline-applet-embed");
    expect(embed.getAttribute("style")).toContain("min-height: 320px");
    expect(embed.getAttribute("style")).not.toContain("max-height");
    expect(embed.className).toContain("overflow-visible");
    expect(embed.className).not.toContain("overflow-auto");
    expect(await screen.findByTestId("applet-iframe-host")).toBeTruthy();
  });

  it("default production render takes the iframe substrate path", async () => {
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

    const host = await screen.findByTestId("applet-iframe-host");
    expect(host).toBeTruthy();
    expect(host.className).not.toContain("h-full");
  });

  it("ignores applet metadata that tries to opt into trusted native rendering", async () => {
    mockUseQuery({
      data: {
        applet: {
          source: "export default function App() { return null; }",
          files: null,
          metadata: { runtimeMode: "nativeTrusted" },
          applet: {
            appId: "app_untrusted_metadata",
            version: 1,
            name: "Untrusted metadata",
          },
        },
      },
    });

    render(<InlineAppletEmbed appId="app_untrusted_metadata" />);

    const embed = await screen.findByTestId("inline-applet-embed");
    expect(embed.getAttribute("data-runtime-mode")).toBe("sandboxedGenerated");
    expect(await screen.findByTestId("applet-iframe-host")).toBeTruthy();
  });
});
