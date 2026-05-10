import {
  cleanup,
  fireEvent,
  render,
  screen,
  within,
  waitFor,
} from "@testing-library/react";
import { useState, type ComponentProps, type ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useQuery } from "urql";
import { loadAppletHostExternals } from "@/applets/host-registry";
import { transformApplet } from "@/applets/transform/transform";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import * as crmPipelineRiskApplet from "@/test/fixtures/crm-pipeline-risk-applet/source";
import { AppletMount, AppletRouteContent } from "./artifacts.$id";

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
      await screen.findByText("A newer version of this artifact is available."),
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

    expect(screen.getByText("Artifact not found.")).toBeTruthy();
  });

  it("default production render takes the iframe substrate path (no loadModule prop)", async () => {
    // Plan-012 U11.5: AppletRouteContent must NOT default loadModule
    // to defaultAppletModuleLoader. Without loadModule, the
    // AppletMount routes to IframeAppletMount which appends an
    // iframe host element (data-testid='applet-iframe-host'). The
    // legacy transformApplet seam MUST NOT fire — that's the
    // load-bearing assertion that the production bypass adversarial
    // review flagged is closed.
    vi.mocked(transformApplet).mockClear();
    vi.mocked(loadAppletHostExternals).mockClear();

    render(
      <AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />,
    );

    const host = await screen.findByTestId("applet-iframe-host");
    expect(host).toBeTruthy();
    expect(vi.mocked(transformApplet)).not.toHaveBeenCalled();
    expect(vi.mocked(loadAppletHostExternals)).not.toHaveBeenCalled();
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
    render(
      <AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />,
    );

    await screen.findByTestId("applet-iframe-host");
    expect(
      screen
        .getByTestId("app-artifact-split-shell")
        .querySelector('[data-generated-app-artifact]'),
    ).toBeTruthy();
    expect(
      screen
        .getByTestId("app-artifact-split-shell")
        .querySelector('[data-runtime-mode="sandboxedGenerated"]'),
    ).toBeTruthy();
    expect(screen.queryByText("Hello applet")).toBeNull();
  });
});

describe("AppletMount", () => {
  it("mounts the migrated CRM pipeline-risk applet through the applet path", async () => {
    render(
      <AppletMount
        appId="33333333-3333-4333-8333-333333333333"
        instanceId="instance-1"
        source="export default function App() { return null; }"
        version={1}
        loadModule={async () => crmPipelineRiskApplet}
      />,
    );

    expect(await screen.findByText("LastMile CRM pipeline risk")).toBeTruthy();
    expect(screen.getByText("Open pipeline")).toBeTruthy();
    expect(screen.getByText("Stage exposure")).toBeTruthy();
    expect(screen.getByText("Product-line exposure")).toBeTruthy();
    expect(screen.getByText("Opportunity risk")).toBeTruthy();
    expect(screen.queryByText("Refresh recipe")).toBeNull();
    expect(screen.queryByText("Source coverage")).toBeNull();
    expect(screen.queryByText("Evidence")).toBeNull();

    expect(screen.queryByText("Refresh app")).toBeNull();

    expect(firstOpportunityRow()).toContain("Regional carrier rollout");
    fireEvent.click(screen.getByRole("button", { name: "Amount" }));
    if (firstOpportunityRow().includes("Regional carrier rollout")) {
      fireEvent.click(screen.getByRole("button", { name: /Amount/ }));
    }
    expect(firstOpportunityRow()).toContain("Cross-dock analytics");
  });

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
      <AppletMountWithHeaderAction
        loadModule={async () => ({ default: MountedApplet, refresh })}
      />,
    );

    await screen.findByText("Count 1");
    expect(screen.queryByText("Refresh app")).toBeNull();

    fireEvent.keyDown(
      await screen.findByRole("button", { name: "Artifact actions" }),
      { key: "Enter", code: "Enter" },
    );
    fireEvent.click(await screen.findByRole("menuitem", { name: "Refresh" }));

    await screen.findByText("Count 2");
    expect(refresh).toHaveBeenCalledTimes(1);
  });

  it("hides refresh when the applet does not export it", async () => {
    const MountedApplet = () => <div>No refresh app</div>;

    render(
      <AppletMountWithHeaderAction
        loadModule={async () => ({ default: MountedApplet })}
      />,
    );

    await screen.findByText("No refresh app");

    expect(screen.queryByRole("button", { name: "Refresh" })).toBeNull();
    expect(
      screen.queryByRole("button", { name: "Artifact actions" }),
    ).toBeNull();
  });

  it("renders transform failures as recoverable app errors", async () => {
    // Plan-012 U11.5: AppletMount defaults to the iframe path; passing
    // loadModule routes back through the legacy same-origin path which
    // calls transformApplet (the mock target). Without loadModule the
    // iframe path skips transformApplet entirely and the
    // mockResolvedValueOnce would leak into the next test.
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
        loadModule={async () => ({ default: () => null })}
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

function AppletMountWithHeaderAction({
  loadModule,
}: {
  loadModule: ComponentProps<typeof AppletMount>["loadModule"];
}) {
  const [headerAction, setHeaderAction] = useState<ReactNode>(null);

  return (
    <>
      <div>{headerAction}</div>
      <AppletMount
        appId="app-1"
        instanceId="instance-1"
        source="export default function App() { return null; }"
        version={1}
        loadModule={loadModule}
        onHeaderActionChange={setHeaderAction}
      />
    </>
  );
}

function firstOpportunityRow() {
  const table = screen.getByRole("table");
  const rows = within(table).getAllByRole("row");
  return rows[1]?.textContent ?? "";
}
