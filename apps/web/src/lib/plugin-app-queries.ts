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

export const PluginAppOverlaysQuery = graphql(`
  query PluginAppOverlays($input: PluginAppOverlayQueryInput!) {
    pluginAppOverlays(input: $input) {
      id
      pluginInstallId
      pluginKey
      appSurfaceKey
      appKey
      provider
      providerRecordType
      providerRecordId
      sectionKey
      payload
      createdByUserId
      updatedByUserId
      createdAt
      updatedAt
    }
  }
`);

export const UpsertPluginAppOverlayMutation = graphql(`
  mutation UpsertPluginAppOverlay($input: UpsertPluginAppOverlayInput!) {
    upsertPluginAppOverlay(input: $input) {
      id
      pluginInstallId
      pluginKey
      appSurfaceKey
      appKey
      provider
      providerRecordType
      providerRecordId
      sectionKey
      payload
      createdByUserId
      updatedByUserId
      createdAt
      updatedAt
    }
  }
`);

export const N8nAppDataQuery = graphql(`
  query N8nAppData($installId: ID!, $executionLimit: Int) {
    n8nAppData(installId: $installId, executionLimit: $executionLimit) {
      installId
      workflowReadinessState
      workflowReadinessReasons
      executionReadinessState
      executionReadinessReasons
      nativeBaseUrl
      workflows {
        externalWorkflowId
        name
        active
        triggerTypes
        lastModifiedAt
        lastExecutionAt
        connectedWorkflowId
        connectedBindingId
        readinessState
        readinessReasons
        nativeWorkflowUrl
        warnings
      }
      executions {
        externalExecutionId
        externalWorkflowId
        workflowName
        status
        mode
        startedAt
        finishedAt
        durationMs
        failureMessage
        nativeExecutionUrl
        nativeWorkflowUrl
        warnings
        bridgeRuns {
          id
          threadId
          threadTurnId
          status
          resumeStatus
          summary
          errorMessage
          updatedAt
        }
      }
    }
  }
`);
