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

export const TwentyEngagementDashboardQuery = graphql(`
  query TwentyEngagementDashboard {
    twentyEngagementDashboard {
      accounts {
        company {
          id
          name
          domainName
          crmUrl
        }
        opportunities {
          opportunity {
            id
            name
            stage
            stageLabel
            amountMicros
            closeDate
            companyId
            companyName
            crmUrl
          }
          layers {
            id
            name
            layerType
            layerTypeLabel
            instanceName
            layerStatus
            layerStatusLabel
            whatWeKnow
            openQuestions
            businessValue
            nextSteps
            opportunityId
          }
        }
      }
      companies {
        id
        name
        domainName
        crmUrl
      }
      opportunities {
        id
        name
        stage
        stageLabel
        amountMicros
        closeDate
        companyId
        companyName
        crmUrl
      }
      opportunityLayers {
        id
        name
        layerType
        layerTypeLabel
        instanceName
        layerStatus
        layerStatusLabel
        whatWeKnow
        openQuestions
        businessValue
        nextSteps
        opportunityId
      }
    }
  }
`);

export const UpdateTwentyEngagementOpportunityStageMutation = graphql(`
  mutation UpdateTwentyEngagementOpportunityStage(
    $input: UpdateTwentyEngagementOpportunityStageInput!
  ) {
    updateTwentyEngagementOpportunityStage(input: $input) {
      id
      name
      stage
      stageLabel
      amountMicros
      closeDate
      companyId
      companyName
      crmUrl
    }
  }
`);

export const UpdateTwentyEngagementOpportunityLayerStatusMutation = graphql(`
  mutation UpdateTwentyEngagementOpportunityLayerStatus(
    $input: UpdateTwentyEngagementOpportunityLayerStatusInput!
  ) {
    updateTwentyEngagementOpportunityLayerStatus(input: $input) {
      id
      name
      layerType
      layerTypeLabel
      instanceName
      layerStatus
      layerStatusLabel
      whatWeKnow
      openQuestions
      businessValue
      nextSteps
      opportunityId
    }
  }
`);
