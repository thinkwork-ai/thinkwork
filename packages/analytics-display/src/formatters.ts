import { analyticsDisplayLimits } from "./limits.js";

const HTML_METACHARS = /[<>"'&]/;
const HTML_METACHARS_GLOBAL = /[<>"'&]/g;

const HTML_ESCAPE: Record<string, string> = {
  "<": "&lt;",
  ">": "&gt;",
  '"': "&quot;",
  "'": "&#39;",
  "&": "&amp;",
};

export function hasHtmlMetacharacters(value: string): boolean {
  return HTML_METACHARS.test(value);
}

export function safeLabel(
  value: unknown,
  maxLength = analyticsDisplayLimits.maxLabelLength,
) {
  if (typeof value !== "string") return "";
  return truncate(value.trim(), maxLength);
}

export function safeDisplayValue(
  value: unknown,
  maxLength = analyticsDisplayLimits.maxLabelLength,
): string {
  if (value == null) return "";
  const text =
    typeof value === "number"
      ? Number.isFinite(value)
        ? value.toLocaleString()
        : ""
      : String(value);
  return truncate(
    text.replace(HTML_METACHARS_GLOBAL, (char) => HTML_ESCAPE[char] ?? ""),
    maxLength,
  );
}

export function formatFreshness(takenAt: string, oldestAt?: string): string {
  if (!takenAt) return "Freshness unknown";
  const taken = oldestAt && oldestAt < takenAt ? oldestAt : takenAt;
  return `Data as of ${taken}`;
}

export function formatProvenance(sourceLabels: string[]): string {
  if (!sourceLabels.length) return "Source unknown";
  return `Source: ${sourceLabels.map((label) => safeDisplayValue(label)).join(", ")}`;
}

function truncate(value: string, maxLength: number): string {
  if (value.length <= maxLength) return value;
  return `${value.slice(0, Math.max(0, maxLength - 1)).trimEnd()}…`;
}
