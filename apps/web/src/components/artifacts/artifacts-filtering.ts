import type { AppArtifactPreview } from "@/lib/app-artifacts";

/**
 * Single row in the Artifacts list. A flat projection of
 * `AppArtifactPreview` containing only the fields the table renders or
 * filters on. Built via `toArtifactItem`.
 */
export interface ArtifactItem {
  id: string;
  /** Underlying Artifact id (different from `id`, which is the App id).
   * Required for favorite/delete mutations on rows. */
  artifactId: string | null;
  title: string;
  /** Display name of the user who generated the artifact (resolved via the
   * source thread). Null when the artifact has no associated user. */
  userName: string | null;
  modelId: string | null;
  stdlibVersion: string | null;
  /** ISO timestamp; may be empty when the upstream payload is missing it. */
  generatedAt: string;
  favoritedAt: string | null;
  version: number | null;
  /** Human-readable kind badge (e.g. "Canvas", "Report", "App"). Null when the
   * type is unknown/unlabelable. */
  typeLabel: string | null;
}

export function toArtifactItem(preview: AppArtifactPreview): ArtifactItem {
  return {
    id: preview.id,
    artifactId: preview.artifactId ?? null,
    title: preview.title,
    userName: preview.userName ?? null,
    modelId: preview.modelId ?? null,
    stdlibVersion: preview.stdlibVersionAtGeneration ?? null,
    generatedAt: preview.generatedAt ?? "",
    favoritedAt: preview.favoritedAt ?? null,
    version: preview.version ?? null,
    typeLabel: "App",
  };
}

/** Raw artifact row from the tenant-wide `artifacts` list query — EVERY kind. */
export interface ArtifactListNode {
  id: string;
  title?: string | null;
  /** Open, plugin-extensible type (uppercase on the wire), e.g. DATA_VIEW,
   * REPORT, or a plugin-minted value like SOC2_EVIDENCE. */
  type?: string | null;
  status?: string | null;
  updatedAt?: string | null;
  headVersion?: number | null;
  metadata?: unknown;
}

/** Backwards-compatible alias — the list node now carries every artifact kind. */
export type CanvasListNode = ArtifactListNode;

/** Applet-kind metadata kinds — these rows are surfaced by the applets query,
 * so the general artifact mapper skips them to avoid duplicate rows. */
const APPLET_METADATA_KINDS = new Set([
  "computer_applet",
  "applet_state",
  "research_dashboard",
]);
const APPLET_TYPES = new Set(["APPLET", "APPLET_STATE"]);

function metadataRecord(meta: unknown): Record<string, unknown> | null {
  return typeof meta === "string"
    ? safeParse(meta)
    : meta && typeof meta === "object" && !Array.isArray(meta)
      ? (meta as Record<string, unknown>)
      : null;
}

function safeParse(value: string): Record<string, unknown> | null {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === "object" && !Array.isArray(parsed)
      ? (parsed as Record<string, unknown>)
      : null;
  } catch {
    return null;
  }
}

/** True when a row is an applet-kind artifact (surfaced by the applets query). */
export function isAppletArtifactNode(node: ArtifactListNode): boolean {
  const record = metadataRecord(node.metadata);
  const kind = typeof record?.kind === "string" ? record.kind : "";
  const uiSurface =
    typeof record?.uiSurface === "string" ? record.uiSurface : "";
  return (
    APPLET_METADATA_KINDS.has(kind) ||
    uiSurface === "app" ||
    APPLET_TYPES.has((node.type ?? "").toUpperCase())
  );
}

/** Title-case a raw artifact type string, e.g. "SOC2_EVIDENCE" -> "Soc2
 * Evidence", "report" -> "Report". */
function titleCaseType(raw: string): string {
  return raw
    .split(/[_\s]+/)
    .filter(Boolean)
    .map((word) => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
    .join(" ");
}

/** Derive the display badge for a general artifact row from its metadata kind
 * and raw type. Living canvases read "Canvas"; document artifacts title-case
 * their genre (Report/Plan/Brief/Ideation); anything else title-cases its raw
 * type, falling back to "Artifact". */
function typeLabelFor(node: ArtifactListNode): string {
  const record = metadataRecord(node.metadata);
  const kind = typeof record?.kind === "string" ? record.kind : "";
  if (kind === "json_render_canvas") return "Canvas";
  const raw = (node.type ?? "").trim();
  if (raw) return titleCaseType(raw);
  return "Artifact";
}

/**
 * Project a general artifact row (any non-applet kind) into an `ArtifactItem`
 * for the shared Artifacts table. Returns `null` for applet-kind rows so they
 * don't duplicate the applets query's rows. `id === artifactId` (the row
 * navigates straight to `/artifacts/$id`); `version` shows the head version.
 */
export function artifactNodeToItem(
  node: ArtifactListNode,
): ArtifactItem | null {
  if (isAppletArtifactNode(node)) return null;
  const record = metadataRecord(node.metadata);
  const kind = typeof record?.kind === "string" ? record.kind : "";
  // Documents must not fall back to "Canvas" for a missing title.
  const titleFallback = kind === "json_render_canvas" ? "Canvas" : "Document";
  return {
    id: node.id,
    artifactId: node.id,
    title: node.title?.trim() || titleFallback,
    userName: null,
    modelId: null,
    stdlibVersion: null,
    generatedAt: node.updatedAt ?? "",
    favoritedAt: null,
    version:
      typeof node.headVersion === "number" && node.headVersion > 0
        ? node.headVersion
        : null,
    typeLabel: typeLabelFor(node),
  };
}

export interface FilterArtifactItemsInput {
  items: ArtifactItem[];
  search: string;
}

export function filterArtifactItems({
  items,
  search,
}: FilterArtifactItemsInput): ArtifactItem[] {
  const needle = search.trim().toLowerCase();
  if (!needle) return items;
  return items.filter((item) => {
    const haystack =
      `${item.title} ${item.modelId ?? ""} ${item.userName ?? ""} ${item.typeLabel ?? ""}`.toLowerCase();
    return haystack.includes(needle);
  });
}

// --- Sort ----------------------------------------------------------------

export const SORT_GENERATED = "generatedAt" as const;
export const SORT_NAME = "name" as const;
export type ArtifactSortBy = typeof SORT_GENERATED | typeof SORT_NAME;

export const DEFAULT_SORT_BY: ArtifactSortBy = SORT_GENERATED;

/**
 * Sort artifacts client-side. Two modes:
 *  - "name": title ascending, case-insensitive via localeCompare.
 *  - "generatedAt": full ISO timestamp descending (newest first), so two
 *    items created on the same calendar date are ordered by time-of-day
 *    even though the column only shows the date. Items with empty
 *    generatedAt sort last in both modes.
 */
export function sortArtifactItems(
  items: ArtifactItem[],
  sortBy: ArtifactSortBy,
): ArtifactItem[] {
  const sorted = items.slice();
  if (sortBy === SORT_NAME) {
    sorted.sort((a, b) =>
      a.title.localeCompare(b.title, undefined, { sensitivity: "base" }),
    );
    return sorted;
  }
  // SORT_GENERATED — descending, empty timestamps last.
  sorted.sort((a, b) => {
    if (!a.generatedAt && !b.generatedAt) return 0;
    if (!a.generatedAt) return 1;
    if (!b.generatedAt) return -1;
    // ISO 8601 strings sort lexicographically the same way they sort as
    // dates, so plain string compare is correct here.
    if (a.generatedAt > b.generatedAt) return -1;
    if (a.generatedAt < b.generatedAt) return 1;
    return 0;
  });
  return sorted;
}
