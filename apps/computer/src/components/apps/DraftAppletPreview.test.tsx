import {
  cleanup,
  fireEvent,
  render,
  screen,
  waitFor,
} from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const promoteDraftAppletMock = vi.fn();

vi.mock("urql", () => ({
  useMutation: () => [{ fetching: false }, promoteDraftAppletMock],
}));

vi.mock("@/applets/mount", () => ({
  AppletFailure: ({ children }: { children: ReactNode }) => (
    <div data-testid="applet-failure">{children}</div>
  ),
  AppletMount: ({
    appId,
    source,
    themeCss,
  }: {
    appId: string;
    source: string;
    themeCss?: string | null;
  }) => (
    <div
      data-app-id={appId}
      data-source={source}
      data-theme-css={themeCss ?? ""}
      data-testid="applet-mount"
    />
  ),
  useAppletInstanceId: (appId: string) => `instance-${appId}`,
}));

import { DraftAppletPreview } from "./DraftAppletPreview";

beforeEach(() => {
  promoteDraftAppletMock.mockReset();
});

afterEach(cleanup);

describe("DraftAppletPreview", () => {
  it("mounts valid draft source inside AI Elements preview chrome", () => {
    render(
      <DraftAppletPreview
        output={{
          type: "draft_app_preview",
          draft: {
            draftId: "draft_123",
            unsaved: true,
            name: "CRM Draft",
            files: {
              "App.tsx": "export default function App() { return null; }",
            },
            validation: { ok: true, status: "passed", errors: [] },
            dataProvenance: {
              status: "real",
              notes: ["Loaded live CRM rows."],
            },
          },
        }}
      />,
    );

    expect(screen.getByTestId("draft-applet-preview")).toBeTruthy();
    expect(screen.getByText("Draft")).toBeTruthy();
    expect(screen.getByText("Unsaved")).toBeTruthy();
    expect(screen.getByText("CRM Draft")).toBeTruthy();
    expect(screen.getByText("Loaded live CRM rows.")).toBeTruthy();
    const mount = screen.getByTestId("applet-mount");
    expect(mount.getAttribute("data-app-id")).toBe("draft_123");
    expect(mount.getAttribute("data-source")).toContain(
      "export default function App",
    );
  });

  it("promotes valid draft source to a saved applet", async () => {
    promoteDraftAppletMock.mockResolvedValue({
      data: {
        promoteDraftApplet: {
          ok: true,
          appId: "33333333-3333-4333-8333-333333333333",
          persisted: true,
          errors: [],
        },
      },
    });

    render(
      <DraftAppletPreview
        output={{
          type: "draft_app_preview",
          draft: {
            draftId: "draft_123",
            computerId: "computer-1",
            unsaved: true,
            name: "CRM Draft",
            files: {
              "App.tsx": "export default function App() { return null; }",
            },
            metadata: {
              threadId: "11111111-1111-4111-8111-111111111111",
              prompt: "Build this",
            },
            sourceDigest: "sha256:abc",
            promotionProof: "draft-app-preview-v1:sig",
            promotionProofExpiresAt: "2026-05-13T18:00:00.000Z",
            validation: { ok: true, status: "passed", errors: [] },
            dataProvenance: {
              status: "real",
              notes: ["Loaded live CRM rows."],
            },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(promoteDraftAppletMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          draftId: "draft_123",
          computerId: "computer-1",
          threadId: "11111111-1111-4111-8111-111111111111",
          sourceDigest: "sha256:abc",
        }),
      });
    });
    expect(screen.getByText("Open saved")).toBeTruthy();
  });

  it("applies uploaded shadcn theme tokens to preview and saved metadata", async () => {
    promoteDraftAppletMock.mockResolvedValue({
      data: {
        promoteDraftApplet: {
          ok: true,
          appId: "33333333-3333-4333-8333-333333333333",
          persisted: true,
          errors: [],
        },
      },
    });

    render(
      <DraftAppletPreview
        output={{
          type: "draft_app_preview",
          draft: {
            draftId: "draft_123",
            computerId: "computer-1",
            unsaved: true,
            files: {
              "App.tsx": "export default function App() { return null; }",
            },
            metadata: {
              threadId: "11111111-1111-4111-8111-111111111111",
            },
            sourceDigest: "sha256:abc",
            promotionProof: "draft-app-preview-v1:sig",
            promotionProofExpiresAt: "2026-05-13T18:00:00.000Z",
            validation: { ok: true, status: "passed", errors: [] },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Theme" }));
    fireEvent.change(screen.getByPlaceholderText(/:root/), {
      target: {
        value:
          ":root { --background: oklch(1 0 0); --chart-1: oklch(0.7 0.2 40); } .dark { --background: oklch(0.145 0 0); }",
      },
    });
    fireEvent.click(screen.getByRole("button", { name: "Apply Theme" }));

    expect(
      screen.getByTestId("applet-mount").getAttribute("data-theme-css"),
    ).toContain("--chart-1");

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(promoteDraftAppletMock).toHaveBeenCalledWith({
        input: expect.objectContaining({
          metadata: expect.objectContaining({
            appletTheme: expect.objectContaining({
              source: "shadcn-create",
              css: expect.stringContaining("--chart-1"),
            }),
          }),
        }),
      });
    });
  });

  it("leaves the draft mounted when promotion validation fails", async () => {
    promoteDraftAppletMock.mockResolvedValue({
      data: {
        promoteDraftApplet: {
          ok: false,
          persisted: false,
          errors: [{ message: "Source digest mismatch." }],
        },
      },
    });

    render(
      <DraftAppletPreview
        output={{
          type: "draft_app_preview",
          draft: {
            draftId: "draft_123",
            computerId: "computer-1",
            unsaved: true,
            files: {
              "App.tsx": "export default function App() { return null; }",
            },
            metadata: {
              threadId: "11111111-1111-4111-8111-111111111111",
            },
            sourceDigest: "sha256:abc",
            promotionProof: "draft-app-preview-v1:sig",
            promotionProofExpiresAt: "2026-05-13T18:00:00.000Z",
            validation: { ok: true, status: "passed", errors: [] },
          },
        }}
      />,
    );

    fireEvent.click(screen.getByRole("button", { name: "Save" }));

    await waitFor(() => {
      expect(screen.getByRole("alert").textContent).toContain(
        "Source digest mismatch",
      );
    });
    expect(screen.getByTestId("applet-mount")).toBeTruthy();
  });

  it("renders validation failures without mounting TSX", () => {
    render(
      <DraftAppletPreview
        output={{
          type: "draft_app_preview",
          draft: {
            draftId: "draft_bad",
            unsaved: true,
            files: {},
            validation: {
              ok: false,
              status: "failed",
              errors: [
                {
                  code: "APP_TSX_REQUIRED",
                  message: "draft_app_preview requires App.tsx.",
                },
              ],
            },
          },
        }}
      />,
    );

    expect(screen.queryByTestId("applet-mount")).toBeNull();
    expect(screen.getByTestId("applet-failure").textContent).toContain(
      "requires App.tsx",
    );
  });
});
