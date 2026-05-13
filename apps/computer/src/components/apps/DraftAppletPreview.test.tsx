import { cleanup, render, screen } from "@testing-library/react";
import type { ReactNode } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/applets/mount", () => ({
  AppletFailure: ({ children }: { children: ReactNode }) => (
    <div data-testid="applet-failure">{children}</div>
  ),
  AppletMount: ({ appId, source }: { appId: string; source: string }) => (
    <div data-app-id={appId} data-source={source} data-testid="applet-mount" />
  ),
  useAppletInstanceId: (appId: string) => `instance-${appId}`,
}));

import { DraftAppletPreview } from "./DraftAppletPreview";

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
