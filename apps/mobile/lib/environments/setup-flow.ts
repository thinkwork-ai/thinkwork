import { extractProfileJson } from "../deployment-profile";
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

/**
 * QR / setup-link import. The scanned profile is treated as a POINTER, not a
 * payload: we read only its host (spacesUrl) and then fetch the environment's
 * published runtime config over TLS — the same server-authoritative path as
 * typed URL entry. This sidesteps the unsigned-profile production gate
 * (no profile signing infrastructure exists, so embedded payloads can never
 * pass it on release builds) and means a tampered QR can at worst point at a
 * different host, never inject endpoint config for a real one.
 */
export async function setupEnvironmentFromDeploymentProfileLink(
  input: string,
  deps: Parameters<typeof setupEnvironmentFromUrl>[1] = {},
): Promise<MobileEnvironmentEntry> {
  let host: string | undefined;
  try {
    const parsed = JSON.parse(extractProfileJson(input)) as {
      spacesUrl?: string;
    };
    host = parsed.spacesUrl?.trim() || undefined;
  } catch {
    throw new Error("This setup link isn't a ThinkWork deployment profile.");
  }
  if (!host) {
    throw new Error("This setup link is missing its environment URL.");
  }
  const result = await setupEnvironmentFromUrl(host, deps);
  if (!result.ok) {
    throw new Error(result.message);
  }
  return result.entry;
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
