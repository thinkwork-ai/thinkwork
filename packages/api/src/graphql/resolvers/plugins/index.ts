import {
  myPluginActivations,
  pluginCatalog,
  pluginInstall,
  pluginInstalls,
} from "./queries.js";
import {
  activatePlugin,
  cutoverTwentyPlugin,
  deactivatePlugin,
  installPlugin,
  retryPluginComponent,
  uninstallPlugin,
  upgradePlugin,
} from "./mutations.js";

export const pluginQueries = {
  pluginCatalog,
  pluginInstalls,
  pluginInstall,
  myPluginActivations,
};

export const pluginMutations = {
  installPlugin,
  upgradePlugin,
  uninstallPlugin,
  retryPluginComponent,
  activatePlugin,
  deactivatePlugin,
  cutoverTwentyPlugin,
};
