import type { MobilePlatformConfig } from "../platform-config";
import { getPlatformConfig } from "../platform-config";
import { getActiveEnvironmentEntry, getEnvironmentEntries } from "./store";

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

/**
 * The setup screen must never trap the user: leaving is allowed whenever the
 * app has anywhere else to go — a saved environment, an active environment,
 * or usable build-time auth config (the sign-in screen renders with any of
 * these). Only a genuine first run (nothing usable at all) hides the exit.
 */
export function canLeaveEnvironmentSetup(): boolean {
  const entries = getEnvironmentEntries();
  if (entries.length > 0) return true;
  if (getActiveEnvironmentEntry() !== null) return true;
  return hasUsableBuildTimeAuthConfig(getPlatformConfig());
}
