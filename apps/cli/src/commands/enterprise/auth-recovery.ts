import { input } from "@inquirer/prompts";
import { Command } from "commander";

import { apiFetch, resolveApiConfig } from "../../api-client.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { printError, printSuccess } from "../../ui.js";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

interface AuthRecoveryOptions {
  stage?: string;
  region?: string;
  tenantId?: string;
  userId?: string;
  redirectUri?: string;
}

export interface IdentityRecoveryGrantResponse {
  startToken: string;
  recipientChallenge: string;
  expiresAt: string;
  routeKeys: string[];
}

export function buildIdentityRecoveryLink(
  redirectUri: string,
  startToken: string,
): string {
  const callback = new URL(redirectUri);
  const recovery = new URL("/accept-invite", callback.origin);
  recovery.searchParams.set("token", startToken);
  return recovery.toString();
}

export async function requestIdentityRecoveryGrant(
  options: {
    stage: string;
    region?: string;
    tenantId: string;
    userId: string;
    redirectUri: string;
  },
  dependencies: {
    resolveApi?: typeof resolveApiConfig;
    fetchApi?: typeof apiFetch;
  } = {},
): Promise<IdentityRecoveryGrantResponse> {
  const api = (dependencies.resolveApi ?? resolveApiConfig)(
    options.stage,
    options.region,
  );
  if (!api) throw new Error("Could not resolve the deployed ThinkWork API.");
  return (dependencies.fetchApi ?? apiFetch)(
    api.apiUrl,
    api.authSecret,
    "/api/auth/enrollment/recover",
    {
      method: "POST",
      body: JSON.stringify({
        tenantId: options.tenantId,
        userId: options.userId,
        redirectUri: options.redirectUri,
      }),
    },
  ) as Promise<IdentityRecoveryGrantResponse>;
}

export function registerEnterpriseAuthRecoveryCommand(
  enterprise: Command,
): void {
  enterprise
    .command("auth-recovery")
    .description(
      "Issue a short-lived Cognito identity recovery grant for a quarantined existing user",
    )
    .option("-s, --stage <name>", "Deployment stage")
    .option("--region <region>", "AWS region")
    .option("--tenant-id <uuid>", "ThinkWork tenant UUID")
    .option("--user-id <uuid>", "Existing ThinkWork user UUID")
    .option(
      "--redirect-uri <uri>",
      "Exact admitted web callback URI, for example https://app.thinkwork.ai/auth/callback",
    )
    .action(async (_options: AuthRecoveryOptions, command: Command) => {
      try {
        const options = command.optsWithGlobals<AuthRecoveryOptions>();
        const stage = await resolveStage({ flag: options.stage });
        const tenantId = await readUuid(
          options.tenantId,
          "ThinkWork tenant UUID",
        );
        const userId = await readUuid(
          options.userId,
          "Existing ThinkWork user UUID",
        );
        const redirectUri = await readRedirectUri(options.redirectUri);
        const grant = await requestIdentityRecoveryGrant({
          stage,
          region: options.region,
          tenantId,
          userId,
          redirectUri,
        });
        const link = buildIdentityRecoveryLink(redirectUri, grant.startToken);

        printSuccess("Identity recovery grant issued.");
        console.log(`\n  Recovery link: ${link}`);
        console.log(`  One-time code: ${grant.recipientChallenge}`);
        console.log(`  Expires:       ${grant.expiresAt}`);
        console.log(
          "\n  Send the link and one-time code to the intended user through separate trusted channels.",
        );
      } catch (cause) {
        printError(cause instanceof Error ? cause.message : "Recovery failed");
        process.exitCode = 1;
      }
    });
}

async function readUuid(
  provided: string | undefined,
  message: string,
): Promise<string> {
  const value =
    provided?.trim() ||
    (await input({
      message,
      validate: (candidate) =>
        UUID_PATTERN.test(candidate.trim()) || "Enter a valid UUID.",
    }));
  if (!UUID_PATTERN.test(value)) throw new Error(`${message} is not valid.`);
  return value;
}

async function readRedirectUri(provided: string | undefined): Promise<string> {
  const value =
    provided?.trim() ||
    (await input({
      message: "Exact admitted web callback URI",
      default: "https://app.thinkwork.ai/auth/callback",
      validate: (candidate) =>
        isHttpUrl(candidate.trim()) || "Enter an absolute HTTP(S) URL.",
    }));
  if (!isHttpUrl(value)) throw new Error("Redirect URI is not valid.");
  return value;
}

function isHttpUrl(value: string): boolean {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
}
