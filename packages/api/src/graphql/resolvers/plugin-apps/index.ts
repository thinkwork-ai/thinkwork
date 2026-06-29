import { installedPluginApps } from "./installedPluginApps.query.js";
import {
  twentyEngagementDashboard,
  updateTwentyEngagementOpportunityLayerStatus,
  updateTwentyEngagementOpportunityStage,
} from "./twenty-client-engagement.js";

export const pluginAppQueries = {
  installedPluginApps,
  twentyEngagementDashboard,
};

export const pluginAppMutations = {
  updateTwentyEngagementOpportunityStage,
  updateTwentyEngagementOpportunityLayerStatus,
};
