import {
  myPluginActivations,
  pluginCatalog,
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
  revokePremiumPluginInstallKey,
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
  activatePluginWithCredentials,
  deactivatePlugin,
  issuePremiumPluginInstallKey,
  redeemPremiumPluginInstallKey,
  revokePremiumPluginInstallKey,
  cutoverTwentyPlugin,
};
