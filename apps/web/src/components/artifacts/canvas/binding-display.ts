/**
 * Living Artifacts (THINK-145 U10): pure display logic for a canvas's
 * data-source bindings — freshness state, refresh-control affordance, and
 * provenance rendering. Kept framework-free so it is unit-testable without a
 * DOM (the badge/control components are thin wrappers over these helpers).
 */

/** Server-persisted freshness quality of a bound widget's data. */
export type BindingQuality = "GOOD" | "STALE" | "BAD" | "SCHEMA_STALE";

/** How the binding's refresh identity is scoped (R9). */
export type BindingAuthContext = "TENANT_MCP" | "PER_USER_OAUTH";

/**
 * Rendered freshness state. `REFRESHING` is a client-only transient overlaid
 * while a re-invoke is in flight — the server never persists it (R8).
 */
export type FreshnessDisplayState = BindingQuality | "REFRESHING";

/** A binding as projected by the `bindings` GraphQL field (redacted args). */
export interface CanvasBinding {
  id: string;
  partId: string;
  elementId: string;
  mcpServerRef: string;
  serverName: string;
  toolName: string;
  redactedArgs: unknown;
  resultShapeHash: string;
  authContext: BindingAuthContext;
  ownerUserId: string | null;
  quality: BindingQuality;
  lastFetchedAt: string | null;
  lastGoodAt: string | null;
}

export interface FreshnessBadgeConfig {
  label: string;
  /** Semantic tone → drives colour classes at the component boundary. */
  tone: "good" | "warn" | "bad" | "schema" | "refreshing";
  /** Short human sentence for the badge title / a11y label. */
  description: string;
}

/**
 * Map a freshness state to its badge presentation. GOOD is deliberately subtle,
 * STALE amber, BAD red, SCHEMA_STALE a distinct (violet) tone so a shape drift
 * reads differently from a transient failure, REFRESHING a spinner tone (R8).
 */
export function freshnessBadgeConfig(
  state: FreshnessDisplayState,
): FreshnessBadgeConfig {
  switch (state) {
    case "GOOD":
      return {
        label: "Live",
        tone: "good",
        description: "Data is up to date.",
      };
    case "STALE":
      return {
        label: "Stale",
        tone: "warn",
        description: "Data may be out of date — refresh to update.",
      };
    case "BAD":
      return {
        label: "Failed",
        tone: "bad",
        description: "Last refresh failed. Showing last-good data.",
      };
    case "SCHEMA_STALE":
      return {
        label: "Needs rebuild",
        tone: "schema",
        description:
          "The data source changed shape. Ask the agent to rebuild this widget.",
      };
    case "REFRESHING":
      return {
        label: "Refreshing",
        tone: "refreshing",
        description: "Fetching fresh data…",
      };
  }
}

export interface RefreshControlState {
  /** Whether the trigger control is interactive. */
  enabled: boolean;
  /** Button label. */
  label: string;
  /** Longer explanation shown as a title / helper. */
  hint: string;
  /**
   * True when this binding's refresh needs the owning user's own action
   * (per-user OAuth owned by the current viewer) — drives the "needs you" copy.
   */
  needsOwnerAction: boolean;
}

/** Short, human display of an owner id when no display name is available. */
export function ownerLabel(ownerUserId: string | null): string {
  if (!ownerUserId) return "another member";
  // Owner display names aren't exposed on the binding; show a compact id so the
  // control still *names* the owner (R9) without leaking a full opaque uuid.
  return `member ${ownerUserId.slice(0, 8)}`;
}

/**
 * Decide the refresh-control affordance for a binding, given the viewer.
 *
 * - Tenant-scoped bindings refresh unattended → any member may trigger.
 * - Per-user-OAuth bindings never refresh unattended (R9): the owner sees an
 *   enabled "refresh needs you" control (runs agent-mediated in a thread);
 *   every other member sees a disabled control that names the owner.
 * - While a refresh is REFRESHING, the control disables regardless (R8) so it
 *   cannot double-fire.
 */
export function refreshControlState(input: {
  binding: Pick<CanvasBinding, "authContext" | "ownerUserId">;
  currentUserId: string | null;
  refreshing: boolean;
}): RefreshControlState {
  const { binding, currentUserId, refreshing } = input;

  if (binding.authContext === "PER_USER_OAUTH") {
    const isOwner =
      !!binding.ownerUserId && binding.ownerUserId === currentUserId;
    if (isOwner) {
      return {
        enabled: !refreshing,
        label: "Refresh needs you",
        hint: "This data uses your connection — refreshing runs in a thread.",
        needsOwnerAction: true,
      };
    }
    return {
      enabled: false,
      label: `Refresh needs ${ownerLabel(binding.ownerUserId)}`,
      hint: `Only ${ownerLabel(binding.ownerUserId)} can refresh this data (it uses their connection).`,
      needsOwnerAction: false,
    };
  }

  return {
    enabled: !refreshing,
    label: refreshing ? "Refreshing…" : "Refresh",
    hint: "Re-run the saved query and update this widget.",
    needsOwnerAction: false,
  };
}

/** A single provenance argument row for display (already redacted). */
export interface ProvenanceArgRow {
  key: string;
  value: string;
}

/**
 * Flatten already-redacted binding args into display rows. Objects/arrays are
 * JSON-stringified compactly; the raw values were redacted server-side (KTD9),
 * so nothing here needs further masking.
 */
export function provenanceArgRows(redactedArgs: unknown): ProvenanceArgRow[] {
  const parsed = coerceRecord(redactedArgs);
  if (!parsed) return [];
  return Object.entries(parsed).map(([key, value]) => ({
    key,
    value: displayValue(value),
  }));
}

function displayValue(value: unknown): string {
  if (value === null || value === undefined) return "—";
  if (typeof value === "string") return value;
  if (typeof value === "number" || typeof value === "boolean") {
    return String(value);
  }
  try {
    return JSON.stringify(value);
  } catch {
    return String(value);
  }
}

function coerceRecord(value: unknown): Record<string, unknown> | null {
  if (typeof value === "string") {
    try {
      return coerceRecord(JSON.parse(value));
    } catch {
      return null;
    }
  }
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}
