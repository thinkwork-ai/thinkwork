import { mkdir, readFile, unlink, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import {
  parseDeploymentProfileJson,
  profileToRuntimeConfig,
  verifyDeploymentProfile,
  type DeploymentProfile,
  type TrustedDeploymentProfileKey,
  type DeploymentProfileValidationResult,
} from "@thinkwork/deployment-profile";
import type { DesktopConfig } from "@thinkwork/desktop-ipc";
import { resolveDeepLinkScheme } from "./deep-link.js";
import type { DesktopEnvSnapshot } from "./env.js";
import { validateDesktopEnv } from "./env.js";

export interface DesktopDeploymentProfileAppLike {
  getPath(name: "userData"): string;
}

export interface DesktopDeploymentProfileManagerOptions {
  app: DesktopDeploymentProfileAppLike;
  env: DesktopEnvSnapshot;
  trustedKeys?: readonly TrustedDeploymentProfileKey[];
  logger?: Pick<typeof console, "warn">;
}

interface ActiveProfile {
  result: DeploymentProfileValidationResult;
}

export class DesktopDeploymentProfileManager {
  readonly profilePath: string;

  private readonly baseEnv: DesktopEnvSnapshot;
  private readonly logger: Pick<typeof console, "warn">;
  private readonly trustedKeys: readonly TrustedDeploymentProfileKey[];
  private activeProfilePromise: Promise<ActiveProfile | null> | null = null;

  constructor(options: DesktopDeploymentProfileManagerOptions) {
    this.baseEnv = options.env;
    this.logger = options.logger ?? console;
    this.trustedKeys =
      options.trustedKeys ?? parseTrustedKeysFromEnvironment(this.logger);
    this.profilePath = join(
      options.app.getPath("userData"),
      "deployment-profile.json",
    );
  }

  async getDesktopConfig(): Promise<DesktopConfig> {
    const active = await this.loadActiveProfile();
    const env = active
      ? envFromProfile(this.baseEnv, active.result)
      : this.baseEnv;
    const validation = validateDesktopEnv(env);
    const deepLinkScheme = resolveDeepLinkScheme(
      env.deepLinkScheme ?? env.stage,
    );

    return {
      stage: env.stage,
      configured: validation.configured,
      missing: [...validation.missing],
      oauthRedirectUri: `${deepLinkScheme}://oauth/callback`,
      endpoints: {
        apiUrl: env.apiUrl,
        graphqlHttpUrl: env.graphqlHttpUrl,
        graphqlUrl: env.graphqlUrl,
        graphqlWsUrl: env.graphqlWsUrl,
        cognitoDomain: env.cognito.domain,
      },
      deployment: active
        ? profileDeploymentSummary(active.result)
        : envDeploymentSummary(this.baseEnv),
    };
  }

  async activeEnv(): Promise<DesktopEnvSnapshot> {
    const active = await this.loadActiveProfile();
    return active ? envFromProfile(this.baseEnv, active.result) : this.baseEnv;
  }

  async importProfileJson(json: string): Promise<DesktopConfig> {
    const result = await this.validateProfileJson(json);
    if (!result.ok || !result.profile) {
      throw new Error(
        result.issues[0]?.message ??
          "Deployment profile could not be validated.",
      );
    }

    await mkdir(dirname(this.profilePath), { recursive: true });
    await writeFile(this.profilePath, normalizedProfileJson(result.profile));
    this.activeProfilePromise = Promise.resolve({
      result,
    });
    return this.getDesktopConfig();
  }

  async removeProfile(): Promise<DesktopConfig> {
    try {
      await unlink(this.profilePath);
    } catch (error) {
      if (!isMissingFileError(error)) throw error;
    }
    this.activeProfilePromise = Promise.resolve(null);
    return this.getDesktopConfig();
  }

  private async loadActiveProfile(): Promise<ActiveProfile | null> {
    this.activeProfilePromise ??= this.readActiveProfile();
    return this.activeProfilePromise;
  }

  private async readActiveProfile(): Promise<ActiveProfile | null> {
    let json: string;
    try {
      json = await readFile(this.profilePath, "utf8");
    } catch (error) {
      if (isMissingFileError(error)) return null;
      throw error;
    }

    const result = await this.validateProfileJson(json);
    if (!result.ok || !result.profile) {
      this.logger.warn(
        "[desktop:deployment-profile] ignoring stored deployment profile",
        result.issues[0]?.message ?? result.status,
      );
      return null;
    }

    return { result };
  }

  private validationOptions() {
    const allowDevelopmentFallback = this.baseEnv.nodeEnv !== "production";
    return {
      allowUnsigned: allowDevelopmentFallback,
      allowHttpLocalhost: allowDevelopmentFallback,
    };
  }

  private async validateProfileJson(
    json: string,
  ): Promise<DeploymentProfileValidationResult> {
    const structural = parseDeploymentProfileJson(
      json,
      this.validationOptions(),
    );
    if (!structural.profile || !structural.profile.signature) return structural;
    if (this.trustedKeys.length === 0) {
      if (this.baseEnv.nodeEnv === "production") {
        return {
          ...structural,
          ok: false,
          status: "unknown_key",
          trust: null,
          issues: [
            {
              status: "unknown_key",
              field: "signature.keyId",
              message:
                "Deployment profile is signed, but this desktop build has no trusted profile signing keys configured.",
            },
          ],
        };
      }
      return structural;
    }
    return verifyDeploymentProfile(
      structural.profile,
      this.trustedKeys,
      this.validationOptions(),
    );
  }
}

function envFromProfile(
  baseEnv: DesktopEnvSnapshot,
  result: DeploymentProfileValidationResult,
): DesktopEnvSnapshot {
  if (!result.profile) return baseEnv;
  const runtime = profileToRuntimeConfig(result.profile);
  return Object.freeze({
    ...baseEnv,
    stage: runtime.stage,
    apiUrl: runtime.apiUrl,
    graphqlHttpUrl: runtime.graphqlHttpUrl,
    graphqlUrl: runtime.graphqlUrl,
    graphqlWsUrl: runtime.graphqlWsUrl,
    cognito: Object.freeze({
      userPoolId: runtime.cognitoUserPoolId,
      clientId: runtime.cognitoClientId,
      domain: runtime.cognitoDomain,
    }),
  });
}

function envDeploymentSummary(
  env: DesktopEnvSnapshot,
): DesktopConfig["deployment"] {
  return {
    source: "env",
    deploymentId: null,
    displayName: env.desktopProductName,
    stage: env.stage,
    region: null,
    profileSha256: null,
    trustStatus: "unsigned",
    trustLabel: "Build-time fallback",
  };
}

function profileDeploymentSummary(
  result: DeploymentProfileValidationResult,
): DesktopConfig["deployment"] {
  const profile = result.profile;
  if (!profile) throw new Error("Deployment profile was not loaded.");

  return {
    source: "profile",
    deploymentId: profile.deploymentId,
    displayName: profile.displayName,
    stage: profile.stage,
    region: profile.region,
    profileSha256: result.profileSha256,
    trustStatus: result.status,
    trustLabel: trustLabel(result),
  };
}

function trustLabel(result: DeploymentProfileValidationResult): string {
  if (result.status === "trusted") {
    return result.trust?.keyId
      ? `Signed by ${result.trust.keyId}`
      : "Signed deployment profile";
  }
  if (result.status === "unsigned") {
    return "Unsigned development profile";
  }
  return result.issues[0]?.message ?? result.status;
}

function normalizedProfileJson(profile: DeploymentProfile): string {
  return `${JSON.stringify(profile, null, 2)}\n`;
}

function isMissingFileError(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    (error as NodeJS.ErrnoException).code === "ENOENT"
  );
}

function parseTrustedKeysFromEnvironment(
  logger: Pick<typeof console, "warn">,
): readonly TrustedDeploymentProfileKey[] {
  const raw = process.env.THINKWORK_DEPLOYMENT_PROFILE_TRUSTED_KEYS_JSON;
  if (!raw?.trim()) return [];
  try {
    const parsed = JSON.parse(raw) as unknown;
    if (!Array.isArray(parsed)) throw new Error("expected an array");
    return parsed.filter(
      (value): value is TrustedDeploymentProfileKey =>
        Boolean(value) &&
        typeof value === "object" &&
        typeof (value as TrustedDeploymentProfileKey).keyId === "string" &&
        typeof (value as TrustedDeploymentProfileKey).publicKeyPem ===
          "string" &&
        typeof (value as TrustedDeploymentProfileKey).issuer === "string",
    );
  } catch (error) {
    logger.warn(
      "[desktop:deployment-profile] ignored malformed trusted keys env",
      error,
    );
    return [];
  }
}
