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
};

/**
 * WorkOS is "configured" once its auth-provider component is provisioned —
 * i.e. the customer's WorkOS account/environment is wired into this
 * deployment. When configured we surface a direct link to the WorkOS
 * dashboard from the list row and the detail header.
 */
export function isWorkosAccountConfigured(
  components: readonly WorkosComponent[] | undefined,
): boolean {
  return Boolean(
    components?.some(
      (component) =>
        component.componentType === "auth-provider" &&
        component.componentKey === WORKOS_AUTH_PLUGIN_KEY &&
        component.state === "provisioned",
    ),
  );
}
