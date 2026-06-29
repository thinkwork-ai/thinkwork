import { graphql } from "@/gql";

// Typed graphql() operations for main-shell plugin apps. Settings owns
// install/configuration; this module owns day-to-day app discovery/launch reads.

export const InstalledPluginAppsQuery = graphql(`
  query InstalledPluginApps {
    installedPluginApps {
      id
      pluginInstallId
      pluginKey
      pluginDisplayName
      pluginVersion
      surfaceKey
      displayName
      appKey
      routeSegment
      mount
      runtime
      description
      icon
      entitlementProductKey
      readiness {
        state
        message
        nextAction
      }
    }
  }
`);
