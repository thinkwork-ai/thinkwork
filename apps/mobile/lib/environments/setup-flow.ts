import { importDeploymentProfile, runtimeConfigFromProfile } from "../deployment-profile";
import {
  addOrUpdateEnvironment,
  type MobileEnvironmentEntry,
} from "./store";
import {
  fetchEnvironmentRuntimeConfig,
  type EnvironmentRuntimeConfigResult,
} from "./runtime-config-fetch";
import type { EnvironmentSetupErrorDetails } from "./url-normalize";

export type EnvironmentSetupResult =
  | { ok: true; entry: MobileEnvironmentEntry }
  | { ok: false; message: string; error: EnvironmentSetupErrorDetails };

export async function setupEnvironmentFromUrl(
  input: string,
  deps: {
    fetchConfig?: (input: string) => Promise<EnvironmentRuntimeConfigResult>;
    saveEnvironment?: typeof addOrUpdateEnvironment;
  } = {},
): Promise<EnvironmentSetupResult> {
  const fetchConfig = deps.fetchConfig ?? fetchEnvironmentRuntimeConfig;
  const saveEnvironment = deps.saveEnvironment ?? addOrUpdateEnvironment;
  const result = await fetchConfig(input);
  if (!result.ok) {
    return {
      ok: false,
      error: result.error,
      message: environmentSetupErrorMessage(result.error, input),
    };
  }

  const entry = await saveEnvironment({
    host: result.host,
    config: result.config,
    displayName: result.config.displayName,
  });
  return { ok: true, entry };
}

export async function setupEnvironmentFromDeploymentProfileLink(
  input: string,
): Promise<MobileEnvironmentEntry> {
  const snapshot = await importDeploymentProfile(input);
  if (!snapshot.profile) {
    throw new Error("Deployment profile could not be imported.");
  }
  const config = runtimeConfigFromProfile(snapshot.profile);
  return addOrUpdateEnvironment({
    host: snapshot.profile.spacesUrl,
    config,
    displayName: snapshot.profile.displayName,
  });
}

export function environmentSetupErrorMessage(
  error: EnvironmentSetupErrorDetails,
  attemptedInput = "",
): string {
  switch (error.kind) {
    case "invalid-url":
      return "That doesn't look like a valid ThinkWork URL.";
    case "unreachable": {
      const host = attemptedInput.trim();
      return host
        ? `Couldn't reach ${host}. Check the URL and your connection.`
        : "Couldn't reach that environment. Check the URL and your connection.";
    }
    case "no-config-published":
      return error.message;
    case "malformed":
      return "This environment's config looks incomplete. Contact your admin.";
  }
}
