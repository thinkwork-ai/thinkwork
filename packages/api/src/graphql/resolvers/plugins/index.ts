import {
  myPluginActivations,
  pluginCatalog,
  pluginCatalogMetadata,
  pluginInstall,
  pluginInstalls,
} from "./queries.js";
import {
  n8nPluginSettings,
  updateN8nPluginApiCredential,
  updateN8nPluginPackageSettings,
} from "./n8n-settings.js";
import { n8nAppData } from "./n8n-app-data.js";
import {
  activatePlugin,
  activatePluginWithCredentials,
  cutoverTwentyPlugin,
  deactivatePlugin,
  configureWorkosAuthPlugin,
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
  n8nPluginSettings,
  n8nAppData,
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
  updateN8nPluginPackageSettings,
  updateN8nPluginApiCredential,
  cutoverTwentyPlugin,
  configureWorkosAuthPlugin,
};
