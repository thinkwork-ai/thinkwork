import type { MobilePlatformConfig } from "../platform-config";

export interface EnvironmentSetupRouteState {
  isAuthenticated: boolean;
  hasStoredSession: boolean;
  isEnvironmentStoreHydrated: boolean;
  environmentCount: number;
  hasActiveEnvironment: boolean;
  platformConfig: MobilePlatformConfig;
}

export function shouldRouteToEnvironmentSetup({
  isAuthenticated,
  hasStoredSession,
  isEnvironmentStoreHydrated,
  environmentCount,
  hasActiveEnvironment,
  platformConfig,
}: EnvironmentSetupRouteState): boolean {
  if (isAuthenticated || hasStoredSession) return false;
  if (!isEnvironmentStoreHydrated || hasActiveEnvironment) return false;
  if (environmentCount > 0) return false;
  if (platformConfig.deployment.source !== "env") return false;
  return !hasUsableBuildTimeAuthConfig(platformConfig);
}

function hasUsableBuildTimeAuthConfig(config: MobilePlatformConfig): boolean {
  return Boolean(
    config.cognitoClientId.trim() &&
      config.cognitoUserPoolId.trim() &&
      config.cognitoDomain.trim(),
  );
}
