const path = require("path");
const { getDefaultConfig } = require("expo/metro-config");

const monorepoRoot = path.resolve(__dirname, "../..");
const workspacePackages = [
  path.resolve(monorepoRoot, "node_modules"),
  path.resolve(monorepoRoot, "packages/react-native-sdk"),
  path.resolve(monorepoRoot, "packages/pricing-config"),
];

/** @type {import('expo/metro-config').MetroConfig} */
const config = getDefaultConfig(__dirname, {
  isCSSEnabled: true,
});

config.watchFolders = workspacePackages;
config.resolver.nodeModulesPaths = [
  path.resolve(__dirname, "node_modules"),
  path.resolve(monorepoRoot, "node_modules"),
];
config.resolver.sourceExts.push("mjs");

// Dedupe: pnpm can resolve two copies of these packages across workspace
// packages (e.g. @thinkwork/react-native-sdk vs apps/mobile) because of
// differing peer-dep matrices. React Context identity requires the same
// module instance, so intercept resolution and force every import back
// to apps/mobile's copy. extraNodeModules alone is only a fallback; by
// the time the SDK's own node_modules/urql symlink is found Metro has
// already committed to a different store path — resolveRequest intercepts
// before that happens.
// Don't dedupe @urql/core — the app doesn't install it directly, so
// forcing apps/mobile as the origin breaks urql's internal
// require("@urql/core"). urql is the only one whose Context identity
// matters for the Provider, so that's the one that has to match.
const DEDUPE = new Set(["react", "react-native", "urql", "graphql"]);
const originalResolveRequest = config.resolver.resolveRequest;
config.resolver.resolveRequest = (context, moduleName, platform) => {
  if (DEDUPE.has(moduleName)) {
    return context.resolveRequest(
      { ...context, originModulePath: path.resolve(__dirname, "package.json") },
      moduleName,
      platform,
    );
  }
  if (typeof originalResolveRequest === "function") {
    return originalResolveRequest(context, moduleName, platform);
  }
  return context.resolveRequest(context, moduleName, platform);
};

const { withNativeWind } = require("nativewind/metro");
module.exports = withNativeWind(config, {
  input: "./global.css",
});
