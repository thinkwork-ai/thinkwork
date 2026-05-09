import * as React from "react";
import L, {
  type LatLngBoundsExpression,
  type LatLngExpression,
  type LatLngTuple,
} from "leaflet";
import "leaflet/dist/leaflet.css";
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png";
import iconUrl from "leaflet/dist/images/marker-icon.png";
import shadowUrl from "leaflet/dist/images/marker-shadow.png";
import {
  CircleMarker,
  GeoJSON,
  MapContainer,
  Marker,
  Polyline,
  Popup,
  TileLayer,
  useMap,
} from "react-leaflet";
import { useTheme } from "@thinkwork/ui";

let iconBootstrapped = false;
function applyDefaultIcon(): void {
  if (iconBootstrapped) return;
  iconBootstrapped = true;
  delete (L.Icon.Default.prototype as { _getIconUrl?: unknown })._getIconUrl;
  L.Icon.Default.mergeOptions({ iconRetinaUrl, iconUrl, shadowUrl });
}

applyDefaultIcon();

// Mapbox styles harvested from lastmile/web-apps `apps/lmi/src/components/map/map.tsx`.
// Client tokens are URL-restricted on the Mapbox dashboard, so shipping them in
// the public Vite bundle is by design (URL allowlist is the security boundary).
const MAPBOX_USERNAME = "ericodom";
const MAPBOX_STYLES = {
  dark: "clkeb986f001e01oh4hmn7i0w",
  light: "cijsn8buv007j8zkqcvbbvkzf",
} as const;

// ISO-3166-1-alpha-2 → south-west / north-east bbox. Curated to the
// most likely target countries; unknown codes fall through to "auto" with
// a console.warn at render time.
const COUNTRY_BBOXES: Record<string, [LatLngTuple, LatLngTuple]> = {
  PT: [
    [36.8, -9.6],
    [42.2, -6.2],
  ],
  US: [
    [24.5, -125.0],
    [49.5, -66.9],
  ],
  GB: [
    [49.9, -8.7],
    [60.9, 1.8],
  ],
  FR: [
    [41.3, -5.4],
    [51.1, 9.7],
  ],
  DE: [
    [47.3, 5.9],
    [55.1, 15.0],
  ],
  ES: [
    [35.9, -9.4],
    [43.8, 4.4],
  ],
  IT: [
    [36.6, 6.6],
    [47.1, 18.5],
  ],
  BR: [
    [-33.8, -73.9],
    [5.3, -34.8],
  ],
  CA: [
    [41.7, -141.0],
    [83.1, -52.6],
  ],
  AU: [
    [-43.6, 113.3],
    [-10.7, 153.6],
  ],
  MX: [
    [14.5, -118.4],
    [32.7, -86.7],
  ],
};

export interface MapMarker {
  lat: number;
  lng: number;
  label?: string;
  popup?: string;
  color?: string;
}

export interface MapPolyline {
  positions: Array<[number, number]>;
  color?: string;
}

export type MapFit =
  | { type: "country"; code: string }
  | { type: "bbox"; bounds: [[number, number], [number, number]] }
  | { type: "auto" };

export interface AppletMapViewProps {
  // Default fits the SW/NE corners of an Atlantic-spanning view; spec-driven
  // applets should always pass an explicit fit.
  fit?: MapFit;
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  // GeoJSON Feature or FeatureCollection objects passed directly to Leaflet's
  // L.GeoJSON layer. Coordinates are [lng, lat] per GeoJSON spec.
  geojson?: unknown[];
  title?: string;
  description?: string;
  height?: number | string;
  // scrollWheelZoom OFF by default — matches the lastmile pattern. Inline
  // applet embeds in chat threads should never trap the page's scroll.
  scrollWheelZoom?: boolean;
}

export function MapView({
  fit = { type: "auto" },
  markers,
  polylines,
  geojson,
  title,
  description,
  height = 320,
  scrollWheelZoom = false,
}: AppletMapViewProps) {
  const { theme } = useTheme();
  const isDark = theme === "dark";
  const token = readMapboxToken();
  const tileUrl = buildTileUrl({ token, isDark });
  const tileAttribution = token
    ? '&copy; <a href="https://www.mapbox.com/about/maps/">Mapbox</a> &copy; <a href="https://openstreetmap.org">OpenStreetMap</a>'
    : '&copy; <a href="https://openstreetmap.org">OpenStreetMap</a> contributors';

  const initial = computeInitialView({ fit, markers, polylines, geojson });

  return (
    <section className="rounded-lg border border-border/70 bg-background p-4">
      {title || description ? (
        <div className="mb-3">
          {title ? <h3 className="text-sm font-semibold">{title}</h3> : null}
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      <div
        className="overflow-hidden rounded-md"
        data-testid="applet-map-view"
        data-tile-provider={token ? "mapbox" : "osm"}
        style={{
          height,
          width: "100%",
          backgroundColor: isDark ? "#1a1a2e" : "#f5f5f5",
        }}
      >
        <MapContainer
          bounds={initial.bounds}
          center={initial.center}
          zoom={initial.zoom}
          scrollWheelZoom={scrollWheelZoom}
          style={{ height: "100%", width: "100%" }}
        >
          <TileLayer
            key={`${theme}-${token ? "mapbox" : "osm"}`}
            url={tileUrl}
            tileSize={token ? 512 : 256}
            zoomOffset={token ? -1 : 0}
            attribution={tileAttribution}
          />
          <FitOnSpecChange
            fit={fit}
            markers={markers}
            polylines={polylines}
            geojson={geojson}
          />
          <Overlays
            markers={markers}
            polylines={polylines}
            geojson={geojson}
          />
        </MapContainer>
      </div>
    </section>
  );
}

function readMapboxToken(): string | undefined {
  if (typeof import.meta === "undefined") return undefined;
  return (import.meta.env?.VITE_MAPBOX_PUBLIC_TOKEN as string | undefined) ||
    undefined;
}

function buildTileUrl({
  token,
  isDark,
}: {
  token: string | undefined;
  isDark: boolean;
}): string {
  if (token) {
    const styleId = isDark ? MAPBOX_STYLES.dark : MAPBOX_STYLES.light;
    return `https://api.mapbox.com/styles/v1/${MAPBOX_USERNAME}/${styleId}/tiles/512/{z}/{x}/{y}@2x?access_token=${token}`;
  }
  return "https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png";
}

interface InitialView {
  bounds?: LatLngBoundsExpression;
  center?: LatLngExpression;
  zoom?: number;
}

function computeInitialView(args: {
  fit: MapFit;
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  geojson?: unknown[];
}): InitialView {
  switch (args.fit.type) {
    case "country": {
      const bbox = COUNTRY_BBOXES[args.fit.code];
      if (bbox) return { bounds: bbox };
      // eslint-disable-next-line no-console
      console.warn(
        `MapView: unknown country code "${args.fit.code}" — falling back to auto fit`,
      );
      return computeAutoBounds(args);
    }
    case "bbox":
      return { bounds: args.fit.bounds };
    case "auto":
      return computeAutoBounds(args);
  }
}

function computeAutoBounds(args: {
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  geojson?: unknown[];
}): InitialView {
  const points: LatLngTuple[] = [];
  args.markers?.forEach((m) => points.push([m.lat, m.lng]));
  args.polylines?.forEach((p) =>
    p.positions.forEach((pos) => points.push(pos)),
  );
  args.geojson?.forEach((feature) => extractGeoJsonCoords(feature, points));

  if (points.length === 0) {
    return {
      bounds: [
        [20, -25],
        [60, 40],
      ],
    };
  }
  if (points.length === 1) {
    return { center: points[0], zoom: 12 };
  }
  return { bounds: L.latLngBounds(points).pad(0.1) };
}

function extractGeoJsonCoords(geo: unknown, sink: LatLngTuple[]): void {
  if (!geo || typeof geo !== "object") return;
  const obj = geo as Record<string, unknown>;
  if (Array.isArray(obj.features)) {
    for (const f of obj.features) extractGeoJsonCoords(f, sink);
  }
  const geometry = obj.geometry as Record<string, unknown> | undefined;
  if (geometry) walkCoordinates(geometry.coordinates, sink);
}

function walkCoordinates(coords: unknown, sink: LatLngTuple[]): void {
  if (!Array.isArray(coords)) return;
  if (
    coords.length >= 2 &&
    typeof coords[0] === "number" &&
    typeof coords[1] === "number"
  ) {
    sink.push([coords[1] as number, coords[0] as number]);
    return;
  }
  for (const child of coords) walkCoordinates(child, sink);
}

function FitOnSpecChange({
  fit,
  markers,
  polylines,
  geojson,
}: {
  fit: MapFit;
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  geojson?: unknown[];
}) {
  const map = useMap();
  React.useEffect(() => {
    const view = computeInitialView({ fit, markers, polylines, geojson });
    if (view.bounds) {
      map.fitBounds(view.bounds);
    } else if (view.center && view.zoom != null) {
      map.setView(view.center, view.zoom);
    }
    // Hash deps so re-renders with stable contents don't re-fit.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hashFit(fit, markers, polylines, geojson), map]);
  return null;
}

function Overlays({
  markers,
  polylines,
  geojson,
}: {
  markers?: MapMarker[];
  polylines?: MapPolyline[];
  geojson?: unknown[];
}) {
  return (
    <>
      {markers?.map((m, idx) => {
        const popup = m.popup ?? m.label;
        if (m.color) {
          return (
            <CircleMarker
              key={`marker-${idx}-${m.lat}-${m.lng}`}
              center={[m.lat, m.lng]}
              radius={8}
              pathOptions={{
                color: m.color,
                fillColor: m.color,
                fillOpacity: 0.7,
              }}
            >
              {popup ? <Popup>{popup}</Popup> : null}
            </CircleMarker>
          );
        }
        return (
          <Marker
            key={`marker-${idx}-${m.lat}-${m.lng}`}
            position={[m.lat, m.lng]}
          >
            {popup ? <Popup>{popup}</Popup> : null}
          </Marker>
        );
      })}
      {polylines?.map((p, idx) => (
        <Polyline
          key={`polyline-${idx}-${djb2(JSON.stringify(p.positions))}`}
          positions={p.positions}
          pathOptions={{ color: p.color ?? "#3b82f6", weight: 3 }}
        />
      ))}
      {geojson?.map((feature, idx) => (
        <GeoJSON
          key={`geojson-${idx}-${djb2(JSON.stringify(feature))}`}
          data={feature as Parameters<typeof GeoJSON>[0]["data"]}
        />
      ))}
    </>
  );
}

function hashFit(
  fit: MapFit,
  markers?: MapMarker[],
  polylines?: MapPolyline[],
  geojson?: unknown[],
): string {
  return JSON.stringify({
    fit,
    markerCount: markers?.length ?? 0,
    polylineCount: polylines?.length ?? 0,
    geojsonCount: geojson?.length ?? 0,
  });
}

function djb2(str: string): string {
  let hash = 5381;
  for (let i = 0; i < str.length; i++) {
    hash = ((hash << 5) + hash + str.charCodeAt(i)) | 0;
  }
  return String(hash);
}
