import { computerArtifactRoute } from "@/lib/computer-routes";

export interface AppArtifactPreview {
  id: string;
  title: string;
  kind: "applet";
  summary: string;
  href: string;
  generatedAt: string;
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
}

export interface AppletPayload {
  source?: string | null;
  files?: Record<string, string> | null;
  metadata?: unknown;
  applet?: AppletPreviewNode | null;
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

export function toAppletPreview(applet: AppletPreviewNode): AppArtifactPreview {
  const title = applet.name?.trim() || "Generated app";
  const prompt = applet.prompt?.trim();
  return {
    id: applet.appId,
    title,
    kind: "applet",
    summary: prompt || `Version ${applet.version ?? 1} generated applet.`,
    href: computerArtifactRoute(applet.appId),
    generatedAt: applet.generatedAt ?? "",
    version: applet.version ?? null,
    prompt: applet.prompt ?? null,
    stdlibVersionAtGeneration: applet.stdlibVersionAtGeneration ?? null,
    modelId: applet.modelId ?? null,
    agentVersion: applet.agentVersion ?? null,
  };
}
