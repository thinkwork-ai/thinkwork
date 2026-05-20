import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

vi.mock("@/components/apps/InlineAppletEmbed", () => ({
  InlineAppletEmbed: ({ appId }: { appId: string }) => (
    <div data-testid="inline-applet-embed-stub" data-app-id={appId} />
  ),
}));

import {
  GeneratedArtifactCard,
  GeneratedArtifactPreview,
} from "./GeneratedArtifactCard";

afterEach(cleanup);

describe("GeneratedArtifactCard", () => {
  it("renders a compact card for app artifacts without mounting the applet inline", () => {
    render(
      <GeneratedArtifactCard
        artifact={{
          id: "artifact_123",
          title: "CRM pipeline risk",
          type: "DATA_VIEW",
          summary: "Pipeline risk dashboard",
          metadata: { kind: "research_dashboard" },
        }}
      />,
    );

    expect(screen.getByText("CRM pipeline risk")).toBeTruthy();
    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.queryByText("DATA_VIEW")).toBeNull();
    expect(screen.queryByTestId("inline-applet-embed-stub")).toBeNull();

    const fullScreenLink = screen.getByRole("link", {
      name: /open artifact full screen/i,
    });
    expect(fullScreenLink.getAttribute("href")).toBe("/artifacts/artifact_123");
  });

  it("opens the artifact panel when a panel callback is provided", () => {
    const onOpenArtifact = vi.fn();
    render(
      <GeneratedArtifactCard
        artifact={{
          id: "artifact_map",
          title: "Austin Interesting Places Map",
          type: "APPLET",
          summary: "Austin map",
          metadata: { kind: "computer_applet" },
        }}
        onOpenArtifact={onOpenArtifact}
      />,
    );

    fireEvent.click(
      screen.getByRole("button", {
        name: /open artifact austin interesting places map/i,
      }),
    );

    expect(onOpenArtifact).toHaveBeenCalledWith("artifact_map");
    expect(screen.queryByTestId("inline-applet-embed-stub")).toBeNull();
    expect(screen.getByRole("link", { name: /open artifact full screen/i }));
  });

  it("renders an applet preview for generated APPLET artifacts when explicitly requested", () => {
    render(
      <GeneratedArtifactPreview
        artifact={{
          id: "artifact_map",
          title: "Austin Interesting Places Map",
          type: "APPLET",
          summary: "Austin map",
          metadata: { kind: "computer_applet" },
        }}
      />,
    );

    const stub = screen.getByTestId("inline-applet-embed-stub");
    expect(stub.getAttribute("data-app-id")).toBe("artifact_map");
    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.queryByText("APPLET")).toBeNull();
    expect(screen.queryByText(/preview unavailable/i)).toBeNull();
  });

  it("does not let generated artifact metadata select the trusted native runtime", () => {
    const { container } = render(
      <GeneratedArtifactPreview
        artifact={{
          id: "artifact_native_claim",
          title: "Native claim",
          type: "APPLET",
          summary: "Metadata tries to escape the sandbox",
          metadata: { kind: "computer_applet", runtimeMode: "nativeTrusted" },
        }}
      />,
    );

    expect(
      container.querySelector('[data-runtime-mode="sandboxedGenerated"]'),
    ).toBeTruthy();
    expect(
      container.querySelector('[data-runtime-mode="nativeTrusted"]'),
    ).toBeNull();
  });

  it("shows Preview unavailable for non-app artifacts", () => {
    render(
      <GeneratedArtifactCard
        artifact={{
          id: "artifact_456",
          title: "Plain note",
          type: "NOTE",
          summary: null,
          metadata: null,
        }}
      />,
    );

    expect(screen.getByText("Plain note")).toBeTruthy();
    expect(screen.queryByTestId("inline-applet-embed-stub")).toBeNull();
    expect(screen.getByText(/preview unavailable/i)).toBeTruthy();
  });
});
