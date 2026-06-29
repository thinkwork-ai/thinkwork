import { installedPluginApps } from "./installedPluginApps.query.js";
import {
  pluginAppOverlaysQuery,
  upsertPluginAppOverlay,
} from "./pluginAppOverlays.js";
import {
  twentyEngagementDashboard,
  updateTwentyEngagementOpportunityLayerStatus,
  updateTwentyEngagementOpportunityStage,
} from "./twenty-client-engagement.js";

export const pluginAppQueries = {
  installedPluginApps,
  pluginAppOverlays: pluginAppOverlaysQuery,
  twentyEngagementDashboard,
};

export const pluginAppMutations = {
  upsertPluginAppOverlay,
  updateTwentyEngagementOpportunityStage,
  updateTwentyEngagementOpportunityLayerStatus,
};
