import { computerArtifactRoute } from "@/lib/computer-routes";
import { appletThemeCssFromMetadata } from "@/applets/theme-tokens";

export const GENERATED_APP_RUNTIME_MODE = "sandboxedGenerated" as const;

export const APP_ARTIFACT_RUNTIME_MODES = [
  GENERATED_APP_RUNTIME_MODE,
  "nativeTrusted",
] as const;

export type AppArtifactRuntimeMode =
  (typeof APP_ARTIFACT_RUNTIME_MODES)[number];

export interface AppArtifactPreview {
  id: string;
  /**
   * Stable artifact id (not appId). Required to call
   * updateArtifact/deleteArtifact for favorite + destructive flows.
   */
  artifactId: string | null;
  title: string;
  kind: "applet";
  summary: string;
  href: string;
  generatedAt: string;
  favoritedAt: string | null;
  version?: number | null;
  prompt?: string | null;
  stdlibVersionAtGeneration?: string | null;
  modelId?: string | null;
  agentVersion?: string | null;
}

export interface AppletPreviewNode {
  appId: string;
  name?: string | null;
  version?: number | null;
  tenantId?: string | null;
  threadId?: string | null;
  prompt?: string | null;
  agentVersion?: string | null;
  modelId?: string | null;
  generatedAt?: string | null;
  stdlibVersionAtGeneration?: string | null;
  artifact?: {
    id: string;
    favoritedAt?: string | null;
  } | null;
}

export interface AppletPayload {
  source?: string | null;
  files?: Record<string, string> | null;
  metadata?: unknown;
  applet?: AppletPreviewNode | null;
}

export function isAppArtifactRuntimeMode(
  value: unknown,
): value is AppArtifactRuntimeMode {
  return (
    typeof value === "string" &&
    (APP_ARTIFACT_RUNTIME_MODES as readonly string[]).includes(value)
  );
}

export function resolveGeneratedAppRuntimeMode(
  _metadata?: unknown,
): typeof GENERATED_APP_RUNTIME_MODE {
  // The sandbox boundary is selected by the authenticated host, never by
  // LLM-authored artifact metadata. Future vetted native apps should take a
  // separate host-owned path instead of reusing generated App metadata.
  return GENERATED_APP_RUNTIME_MODE;
}

export function appletThemeCss(applet: AppletPayload | null): string | null {
  return appletThemeCssFromMetadata(applet?.metadata);
}

export function shortModel(value?: string | null, fallback = "—"): string {
  if (!value) return fallback;
  const parts = value.split(/[/:.]/).filter(Boolean);
  return parts.at(-1) ?? value;
}

export function formatShortDate(
  value?: string | null,
  options: Intl.DateTimeFormatOptions = { month: "short", day: "numeric" },
  fallback = "—",
): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  return date.toLocaleDateString(undefined, options);
}

export function formatShortDateTime(
  value?: string | null,
  fallback = "—",
): string {
  if (!value) return fallback;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return fallback;
  const day = date.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
  });
  const time = date
    .toLocaleTimeString(undefined, {
      hour: "numeric",
      minute: "2-digit",
      hour12: true,
    })
    .replace(/\s+/g, "");
  return `${day}, ${time}`;
}

export function toAppletPreview(applet: AppletPreviewNode): AppArtifactPreview {
  const title = applet.name?.trim() || "Generated app";
  const prompt = applet.prompt?.trim();
  return {
    id: applet.appId,
    artifactId: applet.artifact?.id ?? null,
    title,
    kind: "applet",
    summary: prompt || `Version ${applet.version ?? 1} generated app.`,
    href: computerArtifactRoute(applet.appId),
    generatedAt: applet.generatedAt ?? "",
    favoritedAt: applet.artifact?.favoritedAt ?? null,
    version: applet.version ?? null,
    prompt: applet.prompt ?? null,
    stdlibVersionAtGeneration: applet.stdlibVersionAtGeneration ?? null,
    modelId: applet.modelId ?? null,
    agentVersion: applet.agentVersion ?? null,
  };
}
