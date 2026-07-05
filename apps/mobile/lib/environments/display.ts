import type { MobileEnvironmentEntry } from "./store";
import type { MobilePlatformConfig } from "../platform-config";

export function environmentFooterLabel(
  entry: MobileEnvironmentEntry | null,
  config: MobilePlatformConfig,
): string {
  const deployment = config.deployment;
  const displayName = entry?.displayName || deployment.displayName;
  const stage = entry?.stage || deployment.stage || config.stage;
  const region = entry?.region || deployment.region || "";
  return [displayName, stage, region].filter(Boolean).join(" · ");
}
