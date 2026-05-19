import { execFileSync } from "node:child_process";
import { randomBytes } from "node:crypto";

import { isProdLike } from "../../config.js";
import type { BootstrapStepResult } from "./aws-bootstrap.js";

export const ENTERPRISE_SECRET_NAMES = [
  "TF_VAR_DB_PASSWORD",
  "TF_VAR_API_AUTH_SECRET",
] as const;

export type EnterpriseSecretName = (typeof ENTERPRISE_SECRET_NAMES)[number];

export type EnterpriseStageSecrets = Record<EnterpriseSecretName, string>;

export interface EnterpriseSecretSetter {
  setEnvironmentSecret(
    repository: string,
    stage: string,
    name: EnterpriseSecretName,
    value: string,
  ): Promise<void>;
}

export interface EnterpriseSecretOptions {
  stages: string[];
  dbPassword?: string;
  apiAuthSecret?: string;
  stdinIsTty?: boolean;
  promptSecret?: (stage: string, name: EnterpriseSecretName) => Promise<string>;
  generateSecret?: () => string;
  dryRun?: boolean;
}

export class GhCliEnterpriseSecretSetter implements EnterpriseSecretSetter {
  async setEnvironmentSecret(
    repository: string,
    stage: string,
    name: EnterpriseSecretName,
    value: string,
  ): Promise<void> {
    execFileSync(
      "gh",
      [
        "secret",
        "set",
        name,
        "--repo",
        repository,
        "--env",
        stage,
        "--body",
        value,
      ],
      { encoding: "utf8" },
    );
  }
}

export async function resolveEnterpriseStageSecrets(
  options: EnterpriseSecretOptions,
): Promise<Record<string, EnterpriseStageSecrets>> {
  const generateSecret = options.generateSecret ?? generateUrlSafeSecret;
  const stdinIsTty = options.stdinIsTty ?? process.stdin.isTTY;
  const resolved: Record<string, EnterpriseStageSecrets> = {};

  for (const stage of options.stages) {
    if (options.dryRun) {
      resolved[stage] = {
        TF_VAR_DB_PASSWORD: "<planned>",
        TF_VAR_API_AUTH_SECRET: "<planned>",
      };
      continue;
    }

    resolved[stage] = {
      TF_VAR_DB_PASSWORD: await resolveSecretValue(
        stage,
        "TF_VAR_DB_PASSWORD",
        options.dbPassword,
        stdinIsTty,
        options.promptSecret,
        generateSecret,
      ),
      TF_VAR_API_AUTH_SECRET: await resolveSecretValue(
        stage,
        "TF_VAR_API_AUTH_SECRET",
        options.apiAuthSecret,
        stdinIsTty,
        options.promptSecret,
        generateSecret,
      ),
    };
  }

  return resolved;
}

export async function setEnterpriseStageSecrets(
  repository: string,
  stageSecrets: Record<string, EnterpriseStageSecrets>,
  setter: EnterpriseSecretSetter,
): Promise<BootstrapStepResult[]> {
  const results: BootstrapStepResult[] = [];
  for (const [stage, secrets] of Object.entries(stageSecrets)) {
    for (const [name, value] of Object.entries(secrets) as Array<
      [EnterpriseSecretName, string]
    >) {
      await setter.setEnvironmentSecret(repository, stage, name, value);
    }
    results.push({
      target: `${repository}:${stage}:secrets`,
      status: "updated",
      message: `Updated ${Object.keys(secrets).length} GitHub Environment secret(s) for ${stage}.`,
    });
  }
  return results;
}

export function generateUrlSafeSecret(bytes = 32): string {
  return randomBytes(bytes).toString("base64url");
}

async function resolveSecretValue(
  stage: string,
  name: EnterpriseSecretName,
  explicit: string | undefined,
  stdinIsTty: boolean,
  promptSecret: EnterpriseSecretOptions["promptSecret"],
  generateSecret: () => string,
): Promise<string> {
  if (explicit) return explicit;
  if (!isProdLike(stage)) return generateSecret();
  if (!stdinIsTty) {
    throw new Error(
      `${name} is required for production-like stage "${stage}". Pass an explicit secret value before bootstrapping prod-like deploys.`,
    );
  }
  if (promptSecret) return promptSecret(stage, name);
  const { password } = await import("@inquirer/prompts");
  return password({
    message: `${name} for production-like stage "${stage}":`,
    mask: "*",
    validate: (value) => value.trim().length > 0 || `${name} is required.`,
  });
}
