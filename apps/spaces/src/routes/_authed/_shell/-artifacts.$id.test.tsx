import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useMutation, useQuery } from "urql";
import { usePageHeaderActions } from "@/context/PageHeaderContext";
import { useTenant } from "@/context/TenantContext";
import { AppletMount, AppletRouteContent } from "./artifacts.$id";

vi.mock("urql", () => ({
  gql: (strings: TemplateStringsArray) => strings.join(""),
  useQuery: vi.fn(),
  useMutation: vi.fn(),
}));

vi.mock("@/context/PageHeaderContext", () => ({
  usePageHeaderActions: vi.fn(),
}));

vi.mock("@/context/TenantContext", () => ({
  useTenant: vi.fn(),
}));

const { toastSuccess, toastError } = vi.hoisted(() => ({
  toastSuccess: vi.fn(),
  toastError: vi.fn(),
}));
vi.mock("sonner", () => ({
  toast: { success: toastSuccess, error: toastError },
}));

// Stub CodeMirror with a plain textarea so the editor is interactive in jsdom
// without pulling the full editor runtime.
vi.mock("@uiw/react-codemirror", () => ({
  default: ({
    value,
    onChange,
  }: {
    value: string;
    onChange: (value: string) => void;
  }) => (
    <textarea
      data-testid="applet-source-editor"
      value={value}
      onChange={(event) => onChange(event.target.value)}
    />
  ),
}));

const reexecuteAppletQuery = vi.fn();

function setTenant(overrides: {
  isOperator?: boolean;
  roleResolved?: boolean;
}) {
  vi.mocked(useTenant).mockReturnValue({
    isOperator: overrides.isOperator ?? false,
    roleResolved: overrides.roleResolved ?? true,
    tenantId: "11111111-1111-4111-8111-111111111111",
  } as ReturnType<typeof useTenant>);
}

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

const updateAppletSourceMock = vi.fn();

beforeEach(() => {
  reexecuteAppletQuery.mockReset();
  updateAppletSourceMock.mockReset();
  toastSuccess.mockReset();
  toastError.mockReset();
  setTenant({ isOperator: false, roleResolved: true });
  vi.mocked(useMutation).mockReturnValue([
    { fetching: false, stale: false } as ReturnType<typeof useMutation>[0],
    updateAppletSourceMock,
  ] as unknown as ReturnType<typeof useMutation>);
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

  // Regression: saved-app side panel mounted <AppletMount> without
  // fitContentHeight, so the iframe sized to 100% of its parent and rendered
  // its own inner scrollbar — stacking against the AppCanvasPanel scrollbar
  // and producing the nested-scrollbar bug Eric flagged on 2026-05-22. The
  // mount.tsx host surfaces the prop as a `data-fit-content-height`
  // attribute; assert via toHaveAttribute so this test pins the contract
  // (not the Tailwind class composition, which could be restyled).
  // DraftAppletPreview and InlineAppletEmbed already pass fitContentHeight=
  // true; saved-app parity is the contract this test pins.
  it("mounts the saved applet with fitContentHeight=true so the panel owns the only scrollbar", async () => {
    render(<AppletRouteContent appId="33333333-3333-4333-8333-333333333333" />);

    const host = await screen.findByTestId("applet-iframe-host");
    expect(host.getAttribute("data-fit-content-height")).toBe("true");
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

// U3 — operator-gated Source/Config tabs (R2, R4). The route is never
// OperatorGuard-wrapped; only the extra tabs are gated on isOperator.
describe("operator Source/Config tabs", () => {
  const appId = "33333333-3333-4333-8333-333333333333";

  it("does not render Source/Config tabs for a non-operator", async () => {
    setTenant({ isOperator: false, roleResolved: true });
    render(<AppletRouteContent appId={appId} />);
    await screen.findByTestId("applet-iframe-host");
    expect(screen.queryByRole("tab", { name: "Source" })).toBeNull();
    expect(screen.queryByRole("tab", { name: "Config" })).toBeNull();
  });

  it("hides the tabs until the role resolves (no operator-UI flash)", async () => {
    setTenant({ isOperator: true, roleResolved: false });
    render(<AppletRouteContent appId={appId} />);
    await screen.findByTestId("applet-iframe-host");
    expect(screen.queryByRole("tab", { name: "Source" })).toBeNull();
  });

  it("renders App/Source/Config tabs for a resolved operator", async () => {
    setTenant({ isOperator: true, roleResolved: true });
    render(<AppletRouteContent appId={appId} />);
    await screen.findByTestId("applet-iframe-host");
    expect(screen.getByRole("tab", { name: "App" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Source" })).toBeTruthy();
    expect(screen.getByRole("tab", { name: "Config" })).toBeTruthy();
  });

  it("saves edited source through AdminUpdateAppletSource and refetches", async () => {
    setTenant({ isOperator: true, roleResolved: true });
    updateAppletSourceMock.mockResolvedValue({
      data: { adminUpdateAppletSource: { ok: true, version: 2, errors: [] } },
    });
    render(<AppletRouteContent appId={appId} />);
    await screen.findByTestId("applet-iframe-host");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }));
    const editor = screen.getByTestId(
      "applet-source-editor",
    ) as HTMLTextAreaElement;
    fireEvent.change(editor, {
      target: { value: "export default function App() { return null; }" },
    });
    fireEvent.click(screen.getByTestId("applet-source-save"));

    expect(updateAppletSourceMock).toHaveBeenCalledWith({
      input: {
        appId,
        source: "export default function App() { return null; }",
      },
    });
    await vi.waitFor(() => expect(toastSuccess).toHaveBeenCalled());
    expect(reexecuteAppletQuery).toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
  });

  it("surfaces the real server validation message and does not refetch", async () => {
    setTenant({ isOperator: true, roleResolved: true });
    reexecuteAppletQuery.mockClear();
    // The server returns object errors ({ code, message }), never strings —
    // assert the operator sees the actual message, not a generic fallback.
    updateAppletSourceMock.mockResolvedValue({
      data: {
        adminUpdateAppletSource: {
          ok: false,
          errors: [
            {
              code: "IMPORT_NOT_ALLOWED",
              message: "Import 'fs' is not allowed",
            },
          ],
        },
      },
    });
    render(<AppletRouteContent appId={appId} />);
    await screen.findByTestId("applet-iframe-host");

    fireEvent.mouseDown(screen.getByRole("tab", { name: "Source" }));
    fireEvent.change(screen.getByTestId("applet-source-editor"), {
      target: { value: "broken" },
    });
    fireEvent.click(screen.getByTestId("applet-source-save"));

    await vi.waitFor(() => expect(toastError).toHaveBeenCalled());
    expect(toastError).toHaveBeenCalledWith(
      expect.stringContaining("Import 'fs' is not allowed"),
    );
    expect(reexecuteAppletQuery).not.toHaveBeenCalledWith({
      requestPolicy: "network-only",
    });
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
