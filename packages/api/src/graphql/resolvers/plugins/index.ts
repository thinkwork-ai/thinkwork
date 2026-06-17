import {
  myPluginActivations,
  pluginCatalog,
  pluginCatalogMetadata,
  pluginInstall,
  pluginInstalls,
} from "./queries.js";
import {
  activatePlugin,
  activatePluginWithCredentials,
  cutoverTwentyPlugin,
  deactivatePlugin,
  installPlugin,
  issuePremiumPluginInstallKey,
  redeemPremiumPluginInstallKey,
  refreshPluginCatalog,
  revokePremiumPluginInstallKey,
  retryPluginComponent,
  uninstallPlugin,
  upgradePlugin,
} from "./mutations.js";

export const pluginQueries = {
  pluginCatalog,
  pluginCatalogMetadata,
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
  activatePluginWithCredentials,
  deactivatePlugin,
  refreshPluginCatalog,
  issuePremiumPluginInstallKey,
  redeemPremiumPluginInstallKey,
  revokePremiumPluginInstallKey,
  cutoverTwentyPlugin,
};
