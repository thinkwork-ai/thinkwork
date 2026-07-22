/**
 * Projected twin-page section model (Company Brain U9 / KTD-8) — mobile
 * mirror of `apps/web/src/components/memory/twin-page.tsx`'s parse/format
 * logic. Presentation lives in `components/wiki/twin-sections.tsx`.
 */

export type TwinSectionState = "OK" | "STALE" | "TIMEOUT" | "ERROR";

export interface ProjectedTwinSection {
  slug: string;
  heading: string;
  kind: "facet_backed" | "live_routed" | "knowledge";
  state: TwinSectionState;
  ageSeconds: number | null;
  provenance: "source_backed" | "live" | "knowledge";
  data: Record<string, unknown> | null;
  detail: string | null;
}

export interface TwinEntityPagePayload {
  projected: boolean;
  reason?: string;
  sections?: ProjectedTwinSection[];
}

/** AWSJSON arrives as a JSON-encoded string on the wire — JSON.parse on read. */
export function parseTwinEntityPage(
  value: unknown,
): TwinEntityPagePayload | null {
  try {
    const parsed = typeof value === "string" ? JSON.parse(value) : value;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof (parsed as { projected?: unknown }).projected !== "boolean") {
      return null;
    }
    return parsed as TwinEntityPagePayload;
  } catch {
    return null;
  }
}

export function formatTwinAge(ageSeconds: number | null): string | null {
  if (ageSeconds == null || ageSeconds < 0) return null;
  if (ageSeconds < 60) return "just now";
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const PROVENANCE_LABEL: Record<ProjectedTwinSection["provenance"], string> = {
  source_backed: "Synced",
  live: "Live",
  knowledge: "Knowledge",
};

/** State chip text: state + provenance + cache age when synced. */
export function twinChipLabel(section: ProjectedTwinSection): string {
  const age = formatTwinAge(section.ageSeconds);
  if (section.state === "OK") {
    return `${PROVENANCE_LABEL[section.provenance]}${age ? ` · ${age}` : ""}`;
  }
  if (section.state === "STALE") return `Stale${age ? ` · ${age}` : ""}`;
  if (section.state === "TIMEOUT") return "Timed out";
  return "Unavailable";
}

export function isPlainRecord(
  value: unknown,
): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

export function labelizeTwinKey(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

export function formatTwinValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/** Facet/live sections carry values; knowledge sections carry prose. */
export function twinSectionEntries(
  section: ProjectedTwinSection,
): Array<[string, unknown]> {
  const values = isPlainRecord(section.data)
    ? isPlainRecord(section.data.values)
      ? section.data.values
      : section.data
    : null;
  return values
    ? Object.entries(values).filter(
        ([key]) => !key.startsWith("__") && key !== "facetState",
      )
    : [];
}

export function twinKnowledgeBody(
  section: ProjectedTwinSection,
): string | null {
  const body = isPlainRecord(section.data)
    ? (section.data.bodyMd ?? section.data.summary)
    : null;
  return typeof body === "string" && body ? body : null;
}
