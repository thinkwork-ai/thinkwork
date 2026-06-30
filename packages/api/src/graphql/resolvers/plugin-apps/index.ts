import { installedPluginApps } from "./installedPluginApps.query.js";
import {
  pluginAppOverlaysQuery,
  upsertPluginAppOverlay,
} from "./pluginAppOverlays.js";

export const pluginAppQueries = {
  installedPluginApps,
  pluginAppOverlays: pluginAppOverlaysQuery,
};

export const pluginAppMutations = {
  upsertPluginAppOverlay,
};
