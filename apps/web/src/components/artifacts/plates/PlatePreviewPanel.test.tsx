import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ThemeProvider } from "@thinkwork/ui";

// The panel calls useQuery even when the html seam is set (pause=true), so a
// urql client would otherwise be required — stub it to a paused result.
vi.mock("urql", () => ({
  useQuery: () => [{ data: undefined, fetching: false, error: undefined }],
}));

import { PlatePreviewPanel } from "./PlatePreviewPanel";

const HTML =
  '<!DOCTYPE html><html lang="en"><head><title>Report</title></head><body><h1>Exemplar</h1></body></html>';

function renderPanel(
  props: Partial<React.ComponentProps<typeof PlatePreviewPanel>> = {},
) {
  return render(
    <ThemeProvider>
      <PlatePreviewPanel
        tenantId="t1"
        slug="report"
        displayName="Report"
        html={HTML}
        diagnostics={[]}
        {...props}
      />
    </ThemeProvider>,
  );
}

afterEach(cleanup);

function frame(): HTMLIFrameElement {
  return screen.getByTestId("plate-preview-frame") as HTMLIFrameElement;
}

describe("PlatePreviewPanel", () => {
  it("renders the returned HTML into the sandboxed srcDoc", () => {
    renderPanel();
    const iframe = frame();
    expect(iframe.getAttribute("sandbox")).toBe("");
    expect(iframe.srcdoc).toContain("Exemplar");
  });

  it("swaps the data-theme stamp on the local theme toggle", () => {
    renderPanel();
    // Default app theme is dark → the initial stamp is dark.
    expect(frame().srcdoc).toContain('data-theme="dark"');
    fireEvent.click(screen.getByTestId("plate-preview-theme-light"));
    expect(frame().srcdoc).toContain('data-theme="light"');
    expect(frame().srcdoc).toContain("color-scheme:light");
    fireEvent.click(screen.getByTestId("plate-preview-theme-dark"));
    expect(frame().srcdoc).toContain('data-theme="dark"');
  });

  it("keeps the last-good HTML while showing a diagnostics banner", () => {
    renderPanel({
      diagnostics: [{ code: "TOKEN", message: "Unknown token --nope" }],
    });
    // Panel never blanks: the iframe with the good HTML stays mounted…
    expect(frame().srcdoc).toContain("Exemplar");
    // …and the diagnostics banner surfaces the message.
    const banner = screen.getByTestId("plate-preview-diagnostics");
    expect(banner.textContent).toMatch(/Unknown token --nope/);
  });

  it("shows the empty placeholder when no plate is selected", () => {
    renderPanel({ slug: null, html: undefined });
    expect(screen.getByTestId("plate-preview-empty")).not.toBeNull();
  });
});
