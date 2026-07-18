/**
 * Read-only Cognito federation contract harness.
 *
 * This script deliberately performs no AWS mutations and never emits raw JWTs.
 * It can validate a proposed route manifest and summarize token provenance:
 *
 *   pnpm --filter @thinkwork/api exec tsx \
 *     scripts/cognito-native-federation-spike.ts --manifest /path/to/manifest.json
 *
 * To inspect a token without putting it on the command line, set an environment
 * variable and pass its name:
 *
 *   TOKEN_VALUE=... pnpm --filter @thinkwork/api exec tsx \
 *     scripts/cognito-native-federation-spike.ts --token-env TOKEN_VALUE
 */

import { readFile } from "node:fs/promises";
import { pathToFileURL } from "node:url";

export interface RouteClientContract {
  route: string;
  clientFamily: "web" | "mobile" | "cli" | "desktop" | string;
  providers: string[];
  callbacks: string[];
  logoutUrls?: string[];
  explicitAuthFlows: string[];
}

export interface CapacityLimits {
  appClients: number;
  identityProviders: number;
  callbacksPerClient: number;
  logoutUrlsPerClient: number;
}

export interface FederationManifest {
  clients: RouteClientContract[];
  identityProviders: string[];
  reserve?: {
    appClients?: number;
    identityProviders?: number;
  };
  limits: CapacityLimits;
}

export interface ContractFinding {
  level: "error" | "warning";
  route?: string;
  message: string;
}

export interface TokenProvenance {
  tokenUse: string | null;
  appClientId: string | null;
  issuer: string | null;
  subjectPresent: boolean;
  emailPresent: boolean;
  emailVerified: boolean | null;
  identityProviders: string[];
  expiresAt: number | null;
  expired: boolean | null;
}

function unique(values: string[]): string[] {
  return [...new Set(values)];
}

export function validateManifest(
  manifest: FederationManifest,
): ContractFinding[] {
  const findings: ContractFinding[] = [];
  const reserveClients = manifest.reserve?.appClients ?? 0;
  const reserveProviders = manifest.reserve?.identityProviders ?? 0;

  if (manifest.clients.length + reserveClients > manifest.limits.appClients) {
    findings.push({
      level: "error",
      message: `App-client demand ${manifest.clients.length + reserveClients} exceeds limit ${manifest.limits.appClients}.`,
    });
  }
  if (
    unique(manifest.identityProviders).length + reserveProviders >
    manifest.limits.identityProviders
  ) {
    findings.push({
      level: "error",
      message: `Identity-provider demand ${unique(manifest.identityProviders).length + reserveProviders} exceeds limit ${manifest.limits.identityProviders}.`,
    });
  }

  for (const client of manifest.clients) {
    const providers = unique(client.providers);
    if (providers.length !== client.providers.length) {
      findings.push({
        level: "warning",
        route: client.route,
        message: "Provider allowlist contains duplicates.",
      });
    }
    if (client.callbacks.length > manifest.limits.callbacksPerClient) {
      findings.push({
        level: "error",
        route: client.route,
        message: `Callback demand ${client.callbacks.length} exceeds per-client limit ${manifest.limits.callbacksPerClient}.`,
      });
    }
    if (
      (client.logoutUrls?.length ?? 0) > manifest.limits.logoutUrlsPerClient
    ) {
      findings.push({
        level: "error",
        route: client.route,
        message: `Logout URL demand ${client.logoutUrls?.length ?? 0} exceeds per-client limit ${manifest.limits.logoutUrlsPerClient}.`,
      });
    }
    if (providers.length === 0) {
      findings.push({
        level: "error",
        route: client.route,
        message: "Route has no identity-provider allowlist.",
      });
    }
    if (client.explicitAuthFlows.length === 0) {
      findings.push({
        level: "error",
        route: client.route,
        message: "Route has no explicit Cognito auth-flow allowlist.",
      });
    }
  }

  return findings;
}

function decodePayload(token: string): Record<string, unknown> {
  const parts = token.split(".");
  if (parts.length !== 3 || !parts[1]) {
    throw new Error("Expected a three-part JWT");
  }
  return JSON.parse(
    Buffer.from(parts[1], "base64url").toString("utf8"),
  ) as Record<string, unknown>;
}

export function summarizeToken(
  token: string,
  nowSeconds = Math.floor(Date.now() / 1000),
): TokenProvenance {
  const claims = decodePayload(token);
  const tokenUse =
    typeof claims.token_use === "string" ? claims.token_use : null;
  const expiresAt = typeof claims.exp === "number" ? claims.exp : null;
  const identities = Array.isArray(claims.identities) ? claims.identities : [];
  const identityProviders = identities.flatMap((identity) => {
    if (!identity || typeof identity !== "object") return [];
    const provider = (identity as Record<string, unknown>).providerName;
    return typeof provider === "string" ? [provider] : [];
  });

  return {
    tokenUse,
    appClientId:
      tokenUse === "access"
        ? typeof claims.client_id === "string"
          ? claims.client_id
          : null
        : typeof claims.aud === "string"
          ? claims.aud
          : null,
    issuer: typeof claims.iss === "string" ? claims.iss : null,
    subjectPresent: typeof claims.sub === "string" && claims.sub.length > 0,
    emailPresent: typeof claims.email === "string" && claims.email.length > 0,
    emailVerified:
      typeof claims.email_verified === "boolean"
        ? claims.email_verified
        : claims.email_verified === "true"
          ? true
          : claims.email_verified === "false"
            ? false
            : null,
    identityProviders: unique(identityProviders),
    expiresAt,
    expired: expiresAt === null ? null : expiresAt <= nowSeconds,
  };
}

function argumentValue(name: string): string | undefined {
  const index = process.argv.indexOf(name);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main(): Promise<void> {
  const output: Record<string, unknown> = {
    mode: "read-only",
    generatedAt: new Date().toISOString(),
  };
  const manifestPath = argumentValue("--manifest");
  const tokenEnvironmentName = argumentValue("--token-env");

  if (manifestPath) {
    const manifest = JSON.parse(
      await readFile(manifestPath, "utf8"),
    ) as FederationManifest;
    output.capacity = {
      clients: manifest.clients.length,
      identityProviders: unique(manifest.identityProviders).length,
      findings: validateManifest(manifest),
    };
  }

  if (tokenEnvironmentName) {
    const token = process.env[tokenEnvironmentName];
    if (!token) {
      throw new Error(`Environment variable ${tokenEnvironmentName} is empty.`);
    }
    output.token = summarizeToken(token);
  }

  if (!manifestPath && !tokenEnvironmentName) {
    output.usage = [
      "--manifest <json-file>",
      "--token-env <environment-variable-name>",
    ];
  }

  process.stdout.write(`${JSON.stringify(output, null, 2)}\n`);
}

if (import.meta.url === pathToFileURL(process.argv[1] ?? "").href) {
  main().catch((cause: unknown) => {
    const message = cause instanceof Error ? cause.message : String(cause);
    process.stderr.write(`cognito federation spike failed: ${message}\n`);
    process.exitCode = 1;
  });
}
