import { computerAppArtifactRoute } from "@/lib/computer-routes";

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

export function toAppletPreview(applet: AppletPreviewNode): AppArtifactPreview {
  const title = applet.name?.trim() || "Generated app";
  const prompt = applet.prompt?.trim();
  return {
    id: applet.appId,
    title,
    kind: "applet",
    summary: prompt || `Version ${applet.version ?? 1} generated applet.`,
    href: computerAppArtifactRoute(applet.appId),
    generatedAt: applet.generatedAt ?? "",
    version: applet.version ?? null,
    prompt: applet.prompt ?? null,
    stdlibVersionAtGeneration: applet.stdlibVersionAtGeneration ?? null,
    modelId: applet.modelId ?? null,
    agentVersion: applet.agentVersion ?? null,
  };
}
