/**
 * Shared WorkOS Auth plugin constants and helpers used by both the plugin
 * list (PluginsPage) and the plugin detail page (PluginDetail).
 */

export const WORKOS_AUTH_PLUGIN_KEY = "workos-auth";

/** WorkOS dashboard — applications, redirects, organizations, connections. */
export const WORKOS_DASHBOARD_URL = "https://dashboard.workos.com/";

type WorkosComponent = {
  componentType: string;
  componentKey: string;
  state: string;
  handlerRef?: unknown;
};

export function isWorkosAccountConfigured(
  components: readonly WorkosComponent[] | undefined,
): boolean {
  return Boolean(workosPublishedConfig(components));
}

export function workosPublishedConfig(
  components: readonly WorkosComponent[] | undefined,
): {
  issuerUrl?: string;
  clientId?: string;
  publicOptionLabel?: string;
} | null {
  const component = components?.find(
    (candidate) =>
      candidate.componentType === "auth-provider" &&
      candidate.componentKey === WORKOS_AUTH_PLUGIN_KEY &&
      candidate.state === "provisioned",
  );
  if (!component) return null;

  const ref = parseHandlerRef(component.handlerRef);
  if (
    !ref ||
    ref.status !== "valid" ||
    ref.publicOptionsPublished !== true
  ) {
    return null;
  }

  return {
    issuerUrl: stringValue(ref.issuerUrl),
    clientId: stringValue(ref.clientId),
    publicOptionLabel: stringValue(ref.publicOptionLabel),
  };
}

function parseHandlerRef(value: unknown): Record<string, unknown> | null {
  let ref = value;
  if (typeof ref === "string") {
    try {
      ref = JSON.parse(ref);
    } catch {
      return null;
    }
  }
  if (ref && typeof ref === "object" && !Array.isArray(ref)) {
    return ref as Record<string, unknown>;
  }
  return null;
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value : undefined;
}
