import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";
import { loadAppletHostExternals } from "@/applets/host-registry";
import { transformApplet } from "@/applets/transform/transform";
import { AppletMount, AppletRouteContent } from "./apps.$id";

vi.mock("urql", () => ({
  gql: (strings: TemplateStringsArray) => strings.join(""),
  useQuery: vi.fn(),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/applets/host-registry", () => ({
  loadAppletHostExternals: vi.fn(),
}));

vi.mock("@/applets/transform/transform", () => ({
  transformApplet: vi.fn(),
}));

const reexecuteAppletQuery = vi.fn();

function appletPayload({
  source = "export default function App() { return <main>Hello</main>; }",
  version = 1,
}: {
  source?: string;
  version?: number;
} = {}) {
  return {
    source,
    files: {
      "App.tsx": source,
    },
    metadata: { prompt: "hello" },
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
  vi.mocked(loadAppletHostExternals).mockResolvedValue({} as never);
  vi.mocked(transformApplet).mockResolvedValue({
    ok: true,
    compiledModuleUrl: "blob:applet",
    cacheKey: "cache-key",
    cached: false,
  });
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
  it("fetches, transforms, imports, and mounts a live applet", async () => {
    const MountedApplet = ({
      appId,
      instanceId,
    }: {
      appId: string;
      instanceId: string;
    }) => (
      <div>
        Mounted generated app {appId} {instanceId}
      </div>
    );

    render(
      <AppletRouteContent
        appId="33333333-3333-4333-8333-333333333333"
        loadModule={async () => ({ default: MountedApplet })}
      />,
    );

    await screen.findByText(/Mounted generated app/);
    expect(
      screen.getByText(/33333333-3333-4333-8333-333333333333/),
    ).toBeTruthy();

    expect(useQuery).toHaveBeenCalledWith(
      expect.objectContaining({
        variables: { appId: "33333333-3333-4333-8333-333333333333" },
      }),
    );
    expect(loadAppletHostExternals).toHaveBeenCalled();
    expect(transformApplet).toHaveBeenCalledWith(
      expect.stringContaining("export default function App"),
      1,
      { appId: "33333333-3333-4333-8333-333333333333" },
    );
  });

  it("keeps the mounted version stable until the newer-version banner is reloaded", async () => {
    const MountedApplet = () => <div>Mounted generated app</div>;
    const loadModule = async () => ({ default: MountedApplet });
    const { rerender } = render(
      <AppletRouteContent
        appId="33333333-3333-4333-8333-333333333333"
        loadModule={loadModule}
      />,
    );

    await screen.findByText("Mounted generated app");
    expect(transformApplet).toHaveBeenCalledTimes(1);

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
      <AppletRouteContent
        appId="33333333-3333-4333-8333-333333333333"
        loadModule={loadModule}
      />,
    );

    expect(
      await screen.findByText("A newer version of this app is available."),
    ).toBeTruthy();
    expect(transformApplet).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByRole("button", { name: /reload/i }));

    await waitFor(() => {
      expect(transformApplet).toHaveBeenCalledTimes(2);
    });
    expect(transformApplet).toHaveBeenLastCalledWith(
      expect.stringContaining("Updated"),
      2,
      { appId: "33333333-3333-4333-8333-333333333333" },
    );
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

    expect(screen.getByText("App not found.")).toBeTruthy();
  });
});

describe("AppletMount", () => {
  it("shows refresh only when the applet exports it and passes refreshed data", async () => {
    const refresh = vi.fn().mockResolvedValue({
      data: { count: 2 },
      sourceStatuses: { crm: "success" },
    });
    const MountedApplet = ({ refreshData }: { refreshData?: unknown }) => (
      <div>
        Count{" "}
        {typeof refreshData === "object" && refreshData
          ? String((refreshData as { count?: number }).count)
          : "1"}
      </div>
    );

    render(
      <AppletMount
        appId="app-1"
        instanceId="instance-1"
        source="export default function App() { return null; }"
        version={1}
        loadModule={async () => ({ default: MountedApplet, refresh })}
      />,
    );

    await screen.findByText("Count 1");

    fireEvent.click(screen.getByRole("button", { name: "Refresh" }));

    await screen.findByText("Count 2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("hides refresh when the applet does not export it", async () => {
    const MountedApplet = () => <div>No refresh app</div>;

    render(
      <AppletMount
        appId="app-1"
        instanceId="instance-1"
        source="export default function App() { return null; }"
        version={1}
        loadModule={async () => ({ default: MountedApplet })}
      />,
    );

    await screen.findByText("No refresh app");

    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
  });

  it("renders transform failures as recoverable app errors", async () => {
    vi.mocked(transformApplet).mockResolvedValueOnce({
      ok: false,
      error: { message: "Import not allowed" },
    });

    render(
      <AppletMount
        appId="app-1"
        instanceId="instance-1"
        source="import lodash from 'lodash'"
        version={1}
      />,
    );

    await screen.findByText("Import not allowed");
  });

  it("surfaces runtime render failures through the applet error boundary", async () => {
    const consoleError = vi
      .spyOn(console, "error")
      .mockImplementation(() => undefined);
    const BrokenApplet = () => {
      throw new Error("render exploded");
    };

    try {
      render(
        <AppletMount
          appId="app-1"
          instanceId="instance-1"
          source="export default function App() { return null; }"
          version={1}
          loadModule={async () => ({ default: BrokenApplet })}
        />,
      );

      await waitFor(() => {
        expect(screen.getByText("This app could not render")).toBeTruthy();
      });
      expect(screen.getByText("render exploded")).toBeTruthy();
    } finally {
      consoleError.mockRestore();
    }
  });
});
