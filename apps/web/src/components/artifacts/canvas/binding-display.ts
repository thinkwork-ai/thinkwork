/**
 * Living Artifacts (THINK-145 U10): the canvas data-binding projection types.
 * The in-body freshness/provenance/refresh chrome that consumed the display
 * helpers here was removed in the canvas declutter — refresh feedback now
 * lives in the header refresh action and the agent tools — leaving just the
 * GraphQL projection shape shared by the artifact route and canvas view.
 */

/** Server-persisted freshness quality of a bound widget's data. */
export type BindingQuality = "GOOD" | "STALE" | "BAD" | "SCHEMA_STALE";

/** How the binding's refresh identity is scoped (R9). */
export type BindingAuthContext = "TENANT_MCP" | "PER_USER_OAUTH";

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
