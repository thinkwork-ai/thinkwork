/**
 * Projected twin-page section model (Company Brain U9 / KTD-8 — AE2, AE8).
 *
 * Shared presentational pieces for the living entity page: parse the
 * `twinEntityPage` AWSJSON payload and render each section's independent
 * state (OK with cache age / STALE / TIMEOUT / ERROR) plus its provenance
 * (source-backed clone, live fetch, conversation-derived knowledge). One
 * failed section renders its own state — never a blanked page. When the
 * payload says `projected: false`, callers keep the compiled render (AE8).
 */

import { Badge } from "@thinkwork/ui";

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

export function formatAge(ageSeconds: number | null): string | null {
  if (ageSeconds == null || ageSeconds < 0) return null;
  if (ageSeconds < 60) return "just now";
  const minutes = Math.floor(ageSeconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  return `${Math.floor(hours / 24)}d ago`;
}

const STATE_CLASSES: Record<TwinSectionState, string> = {
  OK: "bg-emerald-500/15 text-emerald-600 dark:text-emerald-400",
  STALE: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  TIMEOUT: "bg-amber-500/15 text-amber-600 dark:text-amber-400",
  ERROR: "bg-red-500/15 text-red-600 dark:text-red-400",
};

const PROVENANCE_LABEL: Record<ProjectedTwinSection["provenance"], string> = {
  source_backed: "Synced",
  live: "Live",
  knowledge: "Knowledge",
};

/** Per-section freshness chip: state + provenance + cache age when synced. */
export function TwinSectionStateChip({
  section,
}: {
  section: ProjectedTwinSection;
}) {
  const age = formatAge(section.ageSeconds);
  const label =
    section.state === "OK"
      ? `${PROVENANCE_LABEL[section.provenance]}${age ? ` · ${age}` : ""}`
      : section.state === "STALE"
        ? `Stale${age ? ` · ${age}` : ""}`
        : section.state === "TIMEOUT"
          ? "Timed out"
          : "Unavailable";
  return (
    <Badge
      className={`text-[10px] font-normal ${STATE_CLASSES[section.state]}`}
      title={section.detail ?? undefined}
      data-twin-state={section.state}
    >
      {label}
    </Badge>
  );
}

function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return !!value && typeof value === "object" && !Array.isArray(value);
}

function labelize(key: string): string {
  return key
    .replace(/[_-]+/g, " ")
    .replace(/([a-z])([A-Z])/g, "$1 $2")
    .replace(/^\w/, (c) => c.toUpperCase());
}

function formatValue(value: unknown): string {
  if (value == null) return "—";
  if (typeof value === "object") return JSON.stringify(value);
  return String(value);
}

/**
 * Section body by kind: knowledge sections carry compiled prose; facet
 * sections carry the cloned attribute values; live sections carry the
 * fetched record. Non-OK sections show their detail line instead of data.
 */
export function TwinSectionBody({
  section,
}: {
  section: ProjectedTwinSection;
}) {
  if (section.state === "ERROR" || section.state === "TIMEOUT") {
    return (
      <p className="text-sm text-muted-foreground">
        This section couldn&apos;t load
        {section.detail ? ` (${section.detail})` : ""} — the rest of the page is
        unaffected.
      </p>
    );
  }
  if (section.provenance === "knowledge") {
    const bodyMd = isPlainRecord(section.data)
      ? (section.data.bodyMd ?? section.data.summary)
      : null;
    return typeof bodyMd === "string" && bodyMd ? (
      <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground">
        {bodyMd}
      </p>
    ) : (
      <p className="text-sm text-muted-foreground">
        Nothing captured here yet.
      </p>
    );
  }
  const values = isPlainRecord(section.data)
    ? isPlainRecord(section.data.values)
      ? section.data.values
      : section.data
    : null;
  const entries = values
    ? Object.entries(values).filter(
        ([key]) => !key.startsWith("__") && key !== "facetState",
      )
    : [];
  if (entries.length === 0) {
    return (
      <p className="text-sm text-muted-foreground">
        {section.state === "STALE"
          ? "No synced values yet."
          : "No values for this section."}
      </p>
    );
  }
  return (
    <dl className="grid grid-cols-[max-content_1fr] gap-x-4 gap-y-1">
      {entries.map(([key, value]) => (
        <div key={key} className="contents">
          <dt className="text-xs uppercase tracking-wider text-muted-foreground">
            {labelize(key)}
          </dt>
          <dd className="text-sm text-foreground">{formatValue(value)}</dd>
        </div>
      ))}
    </dl>
  );
}
