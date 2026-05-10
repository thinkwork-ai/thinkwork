import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it } from "vitest";
import { GeneratedAppArtifactShell } from "./GeneratedAppArtifactShell";

afterEach(cleanup);

describe("GeneratedAppArtifactShell", () => {
  it("renders generated app artifact chrome with title, default label, actions, and content", () => {
    render(
      <GeneratedAppArtifactShell
        title="Austin map"
        description="Curated places in Austin"
        actions={<button type="button">Open full</button>}
      >
        <div>Map canvas</div>
      </GeneratedAppArtifactShell>,
    );

    expect(screen.getByText("Austin map")).toBeTruthy();
    expect(screen.getByText("Curated places in Austin")).toBeTruthy();
    expect(screen.getByText("App")).toBeTruthy();
    expect(screen.getByRole("button", { name: "Open full" })).toBeTruthy();
    expect(screen.getByText("Map canvas")).toBeTruthy();
  });

  it("omits the description row when no description is supplied", () => {
    const { container } = render(
      <GeneratedAppArtifactShell title="CRM dashboard">
        <div>Dashboard canvas</div>
      </GeneratedAppArtifactShell>,
    );

    expect(screen.getByText("CRM dashboard")).toBeTruthy();
    expect(screen.getByText("Dashboard canvas")).toBeTruthy();
    expect(container.querySelector('[class*="leading-5"]')).toBeNull();
  });

  it("defaults to the sandboxed generated runtime mode", () => {
    const { container } = render(
      <GeneratedAppArtifactShell title="Sandboxed app">
        <div>Iframe canvas</div>
      </GeneratedAppArtifactShell>,
    );

    expect(
      container.querySelector('[data-runtime-mode="sandboxedGenerated"]'),
    ).toBeTruthy();
  });

  it("can represent a trusted native runtime without changing the default", () => {
    const { container } = render(
      <GeneratedAppArtifactShell
        title="Trusted surface"
        runtimeMode="nativeTrusted"
      >
        <div>Native canvas</div>
      </GeneratedAppArtifactShell>,
    );

    expect(
      container.querySelector('[data-runtime-mode="nativeTrusted"]'),
    ).toBeTruthy();
  });

  it("can hide generated app chrome when the host route already owns it", () => {
    render(
      <GeneratedAppArtifactShell title="Full page app" showHeader={false}>
        <div>Full canvas</div>
      </GeneratedAppArtifactShell>,
    );

    expect(screen.queryByText("Full page app")).toBeNull();
    expect(screen.getByText("Full canvas")).toBeTruthy();
  });
});
