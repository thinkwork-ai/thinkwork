import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";

// Stub @thinkwork/ui's useTheme so MapView tests don't have to drag the
// ThemeProvider + localStorage init chain through jsdom. Unit tests focus on
// MapView's own logic (fit, tile-provider selection, fallback warnings); the
// theme integration is exercised end-to-end at deploy time.
vi.mock("@thinkwork/ui", async (importOriginal) => {
  const actual = await importOriginal<typeof import("@thinkwork/ui")>();
  return {
    ...actual,
    useTheme: () => ({
      theme: "light",
      toggleTheme: () => {},
      setTheme: () => {},
    }),
  };
});

import { MapView } from "./MapView.js";

afterEach(cleanup);

function renderWithTheme(node: React.ReactElement) {
  return render(node);
}

describe("MapView", () => {
  it("mounts with a country fit and the OSM tile provider when no token is set", () => {
    vi.stubEnv("VITE_MAPBOX_PUBLIC_TOKEN", "");
    renderWithTheme(
      <MapView
        title="Portugal"
        fit={{ type: "country", code: "PT" }}
        markers={[
          { lat: 38.7, lng: -9.1, label: "Lisbon" },
          { lat: 41.1, lng: -8.6, label: "Porto" },
        ]}
      />,
    );
    const view = screen.getByTestId("applet-map-view");
    expect(view.getAttribute("data-tile-provider")).toBe("osm");
    expect(screen.getByText("Portugal")).toBeTruthy();
    vi.unstubAllEnvs();
  });

  it("uses the Mapbox tile provider when VITE_MAPBOX_PUBLIC_TOKEN is set", () => {
    vi.stubEnv("VITE_MAPBOX_PUBLIC_TOKEN", "pk.test_mapbox_token");
    renderWithTheme(
      <MapView fit={{ type: "country", code: "US" }} />,
    );
    const view = screen.getByTestId("applet-map-view");
    expect(view.getAttribute("data-tile-provider")).toBe("mapbox");
    vi.unstubAllEnvs();
  });

  it("warns and falls back to auto fit when given an unknown country code", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithTheme(<MapView fit={{ type: "country", code: "ZZ" }} />);
    expect(warn).toHaveBeenCalledWith(
      expect.stringContaining('unknown country code "ZZ"'),
    );
    expect(screen.getByTestId("applet-map-view")).toBeTruthy();
    warn.mockRestore();
  });

  it("renders bbox fit without warnings", () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    renderWithTheme(
      <MapView
        fit={{
          type: "bbox",
          bounds: [
            [40, -9],
            [42, -7],
          ],
        }}
      />,
    );
    expect(screen.getByTestId("applet-map-view")).toBeTruthy();
    expect(warn).not.toHaveBeenCalled();
    warn.mockRestore();
  });

  it("renders auto fit with markers + polylines + geojson without crashing", () => {
    renderWithTheme(
      <MapView
        fit={{ type: "auto" }}
        markers={[{ lat: 30.27, lng: -97.74 }]}
        polylines={[
          {
            positions: [
              [30.27, -97.74],
              [30.4, -97.7],
            ],
          },
        ]}
        geojson={[
          {
            type: "Feature",
            geometry: { type: "Point", coordinates: [-97.74, 30.27] },
            properties: {},
          },
        ]}
      />,
    );
    expect(screen.getByTestId("applet-map-view")).toBeTruthy();
  });
});
