import { GraphQLError } from "graphql";
import type {
  PluginManifest,
  PluginVersion,
  UiSurfaceComponent,
} from "@thinkwork/plugin-catalog/contracts";
import type { GraphQLContext } from "../../context.js";
import {
  compareSemverDesc,
  getPluginCatalog,
} from "../../../lib/plugins/catalog-source.js";
import { createDefaultPluginEngineDeps } from "../../../lib/plugins/engine.js";
import type {
  PluginComponentRow,
  PluginInstallRow,
  UserPluginActivationRow,
} from "../../../lib/plugins/store.js";
import { requirePluginTenantMember } from "../plugins/shared.js";

export interface InstalledPluginAppPayload {
  id: string;
  pluginInstallId: string;
  pluginKey: string;
  pluginDisplayName: string;
  pluginVersion: string;
  surfaceKey: string;
  displayName: string;
  appKey: string;
  routeSegment: string;
  mount: string;
  runtime: string;
  description: string | null;
  icon: string | null;
  entitlementProductKey: string | null;
  readiness: {
    state:
      | "ready"
      | "install_in_progress"
      | "operator_setup_required"
      | "component_unavailable"
      | "activation_required";
    message: string;
    nextAction: string | null;
  };
}

interface CatalogPlugin {
  pluginKey: string;
  displayName: string;
  versions: Array<{
    version: string;
    payload: PluginVersion;
  }>;
}

interface LaunchableSurface {
  surface: UiSurfaceComponent & {
    launch: NonNullable<UiSurfaceComponent["launch"]>;
  };
  requireSurfaceComponent: boolean;
}

export async function installedPluginApps(
  _parent: unknown,
  _args: Record<string, never>,
  ctx: GraphQLContext,
): Promise<InstalledPluginAppPayload[]> {
  const { tenantId, callerUserId } = await requirePluginTenantMember(ctx);
  if (!callerUserId) {
    throw new GraphQLError("User context required", {
      extensions: { code: "FORBIDDEN" },
    });
  }

  const catalog = await getPluginCatalog();
  const pluginsByKey = new Map(
    catalog.plugins.map((plugin) => [
      plugin.pluginKey,
      plugin as CatalogPlugin,
    ]),
  );
  const deps = createDefaultPluginEngineDeps();
  const installs = await deps.store.listInstalls(tenantId);
  if (installs.length === 0) return [];

  const activations = await deps.store.listActivationsForUser(
    callerUserId,
    installs.map((install) => install.id),
  );
  const activationByInstallId = new Map(
    activations.map((activation) => [activation.plugin_install_id, activation]),
  );

  const apps: InstalledPluginAppPayload[] = [];
  for (const install of installs) {
    const catalogPlugin = pluginsByKey.get(install.plugin_key);
    if (!catalogPlugin) continue;
    const pinned = findPinnedVersion(catalogPlugin, install.pinned_version);
    if (!pinned) continue;

    const launchableSurfaces = launchableAppSurfacesForInstall(
      install,
      catalogPlugin,
      pinned.payload,
    );
    if (launchableSurfaces.length === 0) continue;

    const components = await deps.store.listComponents(install.id);
    const componentByKey = new Map(
      components.map((component) => [component.component_key, component]),
    );
    const activation = activationByInstallId.get(install.id) ?? null;

    for (const { surface, requireSurfaceComponent } of launchableSurfaces) {
      const launch = surface.launch!;
      apps.push({
        id: `${install.id}:${surface.key}`,
        pluginInstallId: install.id,
        pluginKey: install.plugin_key,
        pluginDisplayName: catalogPlugin.displayName,
        pluginVersion: install.pinned_version,
        surfaceKey: surface.key,
        displayName: surface.displayName,
        appKey: launch.appKey,
        routeSegment: launch.routeSegment,
        mount: launch.mount,
        runtime: launch.runtime,
        description: launch.description ?? null,
        icon: launch.icon ?? null,
        entitlementProductKey: launch.entitlementProductKey ?? null,
        readiness: readinessForApp({
          install,
          manifestVersion: pinned.payload,
          surface,
          components,
          componentByKey,
          activation,
          requireSurfaceComponent,
        }),
      });
    }
  }

  return apps.sort((a, b) => {
    const byPlugin = a.pluginDisplayName.localeCompare(b.pluginDisplayName);
    return byPlugin === 0
      ? a.displayName.localeCompare(b.displayName)
      : byPlugin;
  });
}

function findPinnedVersion(plugin: CatalogPlugin, pinnedVersion: string) {
  const versions = [...plugin.versions].sort((a, b) =>
    compareSemverDesc(a.version, b.version),
  );
  return versions.find((version) => version.version === pinnedVersion) ?? null;
}

function launchableAppSurfacesForInstall(
  install: PluginInstallRow,
  catalogPlugin: CatalogPlugin,
  manifestVersion: PluginVersion,
): LaunchableSurface[] {
  const pinnedSurfaces = launchableAppSurfaces(manifestVersion).map(
    (surface) => ({
      surface,
      requireSurfaceComponent: true,
    }),
  );
  if (pinnedSurfaces.length > 0) return pinnedSurfaces;

  const compatibilitySurface = n8nWorkflowOperationsCompatibilitySurface(
    install,
    catalogPlugin,
    manifestVersion,
  );
  return compatibilitySurface
    ? [{ surface: compatibilitySurface, requireSurfaceComponent: false }]
    : [];
}

function launchableAppSurfaces(version: PluginVersion) {
  return version.components.filter(
    (
      component,
    ): component is UiSurfaceComponent & {
      launch: NonNullable<UiSurfaceComponent["launch"]>;
    } => component.type === "ui-surface" && component.launch?.type === "app",
  );
}

function n8nWorkflowOperationsCompatibilitySurface(
  install: PluginInstallRow,
  catalogPlugin: CatalogPlugin,
  manifestVersion: PluginVersion,
) {
  if (install.plugin_key !== "n8n") return null;
  const hasWorkflowOperationsSurface = launchableAppSurfaces(
    manifestVersion,
  ).some((surface) => surface.launch.appKey === "n8n-workflow-operations");
  if (hasWorkflowOperationsSurface) return null;

  const versions = [...catalogPlugin.versions].sort((a, b) =>
    compareSemverDesc(a.version, b.version),
  );
  for (const version of versions) {
    const surface = launchableAppSurfaces(version.payload).find(
      (candidate) =>
        candidate.key === "workflow-operations" &&
        candidate.launch.appKey === "n8n-workflow-operations",
    );
    if (surface) return surface;
  }
  return null;
}

function readinessForApp({
  install,
  manifestVersion,
  surface,
  components,
  componentByKey,
  activation,
  requireSurfaceComponent,
}: {
  install: PluginInstallRow;
  manifestVersion: PluginVersion;
  surface: UiSurfaceComponent;
  components: PluginComponentRow[];
  componentByKey: Map<string, PluginComponentRow>;
  activation: UserPluginActivationRow | null;
  requireSurfaceComponent: boolean;
}): InstalledPluginAppPayload["readiness"] {
  if (install.state === "installing" || install.state === "awaiting_approval") {
    return {
      state: "install_in_progress",
      message: "Plugin installation is still in progress.",
      nextAction: "wait",
    };
  }
  if (install.state === "failed" || install.state === "uninstalling") {
    return {
      state: "operator_setup_required",
      message:
        "Plugin installation needs operator attention before this app can launch.",
      nextAction: "open_plugin_settings",
    };
  }

  const surfaceComponent = componentByKey.get(surface.key);
  if (requireSurfaceComponent && !componentIsProvisioned(surfaceComponent)) {
    return {
      state: "component_unavailable",
      message: "The app surface has not been provisioned yet.",
      nextAction: "open_plugin_settings",
    };
  }

  const missingRequiredComponent = requiredRuntimeComponentMissing(
    manifestVersion,
    components,
  );
  if (missingRequiredComponent) {
    return {
      state: "component_unavailable",
      message: `${missingRequiredComponent.displayName} is not ready yet.`,
      nextAction: "open_plugin_settings",
    };
  }

  if (versionNeedsUserActivation(manifestVersion)) {
    if (!activation || activation.status !== "active") {
      return {
        state: "activation_required",
        message: "Connect this plugin before launching the app.",
        nextAction: "connect_plugin",
      };
    }
  }

  return {
    state: "ready",
    message: "Ready to launch.",
    nextAction: null,
  };
}

function requiredRuntimeComponentMissing(
  version: PluginVersion,
  components: PluginComponentRow[],
): { displayName: string } | null {
  const rowsByKey = new Map(
    components.map((component) => [component.component_key, component]),
  );
  for (const component of version.components) {
    if (
      component.type !== "mcp-server" &&
      component.type !== "infrastructure"
    ) {
      continue;
    }
    const row = rowsByKey.get(component.key);
    if (!componentIsProvisioned(row)) {
      return {
        displayName:
          "displayName" in component
            ? (component.displayName ?? component.key)
            : component.key,
      };
    }
  }
  return null;
}

function componentIsProvisioned(
  component: PluginComponentRow | undefined,
): boolean {
  return component?.state === "provisioned";
}

function versionNeedsUserActivation(version: PluginVersion): boolean {
  return version.components.some((component) => {
    if (component.type !== "mcp-server") return false;
    return (
      component.auth.mode === "oauth" ||
      component.auth.mode === "oauth-per-instance" ||
      component.auth.mode === "user-provided-headers"
    );
  });
}
