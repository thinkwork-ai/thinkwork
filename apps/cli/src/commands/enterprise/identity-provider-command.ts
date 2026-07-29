import { execFileSync, spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { readFileSync } from "node:fs";

import { input, password } from "@inquirer/prompts";
import { Command, InvalidArgumentError } from "commander";

import { getAwsIdentity } from "../../aws.js";
import { resolveStage } from "../../lib/resolve-stage.js";
import { confirm } from "../../prompt.js";
import { printError, printSuccess } from "../../ui.js";
import {
  parsePriorControllerInput,
  recoverPriorControllerInput,
  type PriorControllerInput,
} from "../release/helpers.js";
import {
  buildTenantEntraConnectionMetadata,
  buildTenantEntraSecretName,
  type TenantEntraConnectionMetadata,
} from "./identity-provider.js";

export const TENANT_ENTRA_ACTIONS = [
  "create",
  "validate",
  "rotate",
  "disable",
] as const;
export type TenantEntraAction = (typeof TENANT_ENTRA_ACTIONS)[number];

interface IdentityProviderOptions {
  stage?: string;
  directoryId?: string;
  tenantId?: string;
  clientId?: string;
  displayName?: string;
  label?: string;
  hostname?: string[];
  yes?: boolean;
  wait?: boolean;
}

interface AuthReconciliationState {
  desiredRevision?: number;
  tenantConnections?: Array<Record<string, unknown>>;
}

export interface AwsExecutor {
  read(args: string[]): string;
  writeJson(args: string[], input: unknown): string;
}

const defaultAws: AwsExecutor = {
  read(args) {
    return execFileSync("aws", args, {
      encoding: "utf8",
      timeout: 60_000,
      stdio: ["ignore", "pipe", "pipe"],
    }).trim();
  },
  writeJson(args, input) {
    const result = spawnSync("aws", args, {
      encoding: "utf8",
      timeout: 60_000,
      input: JSON.stringify(input),
      stdio: ["pipe", "pipe", "pipe"],
    });
    if (result.status !== 0) {
      // Never include stderr: AWS/CLI diagnostics are not guaranteed to avoid
      // echoing the secret-bearing stdin document.
      throw new Error(
        `AWS command failed with exit code ${result.status ?? "unknown"}.`,
      );
    }
    return result.stdout.trim();
  },
};

function collect(value: string, previous: string[] = []): string[] {
  return [...previous, value];
}

function parseAction(value: string): TenantEntraAction {
  const normalized = value.toLowerCase();
  if (TENANT_ENTRA_ACTIONS.includes(normalized as TenantEntraAction)) {
    return normalized as TenantEntraAction;
  }
  throw new InvalidArgumentError(
    `Action must be one of: ${TENANT_ENTRA_ACTIONS.join(", ")}.`,
  );
}

export function registerEnterpriseIdentityProviderCommand(
  enterprise: Command,
): void {
  enterprise
    .command("identity-provider")
    .description(
      "Create, validate, rotate, or disable a tenant-specific Microsoft Entra OIDC route",
    )
    .argument("<action>", "Lifecycle action", parseAction)
    .option("--directory-id <uuid>", "Microsoft Entra directory (tenant) GUID")
    .option("-s, --stage <name>", "Deployment stage")
    .option("--tenant-id <uuid>", "ThinkWork tenant UUID (required for create)")
    .option(
      "--client-id <id>",
      "Microsoft application client ID (required for create)",
    )
    .option("--display-name <name>", "Safe connection display name")
    .option("--label <label>", "Tenant label shown in operator diagnostics")
    .option(
      "--hostname <host>",
      "Tenant login hostname; repeat for aliases (required for create)",
      collect,
      [],
    )
    .option("-y, --yes", "Skip confirmation")
    .option("--no-wait", "Start the controller run and return")
    .action(
      async (
        action: TenantEntraAction,
        _options: IdentityProviderOptions,
        command: Command,
      ) => {
        try {
          await runIdentityProviderOperation(
            action,
            command.optsWithGlobals<IdentityProviderOptions>(),
          );
        } catch (error) {
          printError((error as Error).message);
          process.exitCode = 1;
        }
      },
    );
}

export function writeTenantEntraSecret(
  options: {
    stage: string;
    directoryId: string;
    clientId: string;
    clientSecret: string;
    versionStage?: "AWSPENDING";
  },
  aws: AwsExecutor = defaultAws,
): string {
  const secretName = buildTenantEntraSecretName(
    options.stage,
    options.directoryId,
  );
  let existingArn: string | undefined;
  try {
    existingArn = aws.read([
      "secretsmanager",
      "describe-secret",
      "--secret-id",
      secretName,
      "--query",
      "ARN",
      "--output",
      "text",
    ]);
  } catch {
    existingArn = undefined;
  }
  const secretString = JSON.stringify({
    clientId: options.clientId,
    clientSecret: options.clientSecret,
  });
  if (existingArn) {
    aws.writeJson(
      [
        "secretsmanager",
        "put-secret-value",
        "--cli-input-json",
        "file:///dev/stdin",
        "--query",
        "ARN",
        "--output",
        "text",
      ],
      {
        SecretId: existingArn,
        SecretString: secretString,
        ...(options.versionStage
          ? { VersionStages: [options.versionStage] }
          : {}),
      },
    );
    return existingArn;
  }
  const arn = aws.writeJson(
    [
      "secretsmanager",
      "create-secret",
      "--cli-input-json",
      "file:///dev/stdin",
      "--query",
      "ARN",
      "--output",
      "text",
    ],
    {
      Name: secretName,
      Description: "ThinkWork tenant-specific Microsoft Entra OIDC credentials",
      SecretString: secretString,
    },
  );
  if (!arn.startsWith("arn:aws:secretsmanager:")) {
    throw new Error("Secrets Manager did not return a secret ARN.");
  }
  return arn;
}

export function buildIdentityProviderControllerInput(options: {
  prior: PriorControllerInput;
  action: TenantEntraAction;
  connection: TenantEntraConnectionMetadata;
  desiredRevision: number;
  sessionId?: string;
}): Record<string, unknown> {
  const { prior } = options;
  if (
    !prior.releaseVersion ||
    !prior.releaseManifestUrl ||
    !prior.releaseManifestSha256
  ) {
    throw new Error(
      "The previous successful deployment lacks a release manifest pin; deploy a current release first.",
    );
  }
  const sessionId = options.sessionId ?? randomUUID();
  const revision = options.desiredRevision + 1;
  const preservedConfig = {
    ...(prior.customerDomain ? { customerDomain: prior.customerDomain } : {}),
    ...(prior.customerDomainDelegated !== undefined
      ? { customerDomainDelegated: prior.customerDomainDelegated }
      : {}),
    ...(prior.customerDomainLegacyRetired !== undefined
      ? { customerDomainLegacyRetired: prior.customerDomainLegacyRetired }
      : {}),
  };
  return {
    schemaVersion: 1,
    contract: "thinkwork.deployment.controller.v1",
    phase: "update",
    action: "update",
    sessionId,
    customerName: prior.customerName,
    environmentName: prior.environmentName,
    awsAccountId: prior.awsAccountId,
    awsRegion: prior.awsRegion,
    availabilityZones: prior.availabilityZones,
    evidenceBucket: prior.evidenceBucket,
    source: "enterprise-identity-provider-cli",
    runnerSecretArn:
      prior.runnerSecretArn ??
      `/thinkwork/${prior.environmentName}/deployment/runner-secrets`,
    preservedConfig,
    releaseVersion: prior.releaseVersion,
    releaseManifestUrl: prior.releaseManifestUrl,
    releaseManifestSha256: prior.releaseManifestSha256,
    terraformModuleSource:
      prior.terraformModuleSource ?? "thinkwork-ai/thinkwork/aws",
    terraformModuleVersion:
      prior.terraformModuleVersion ?? prior.releaseVersion.replace(/^v/, ""),
    operation: {
      kind: "identity_provider",
      action: options.action,
      revision,
      expectedPreviousRevision: options.desiredRevision,
      connection: options.connection,
      plan: true,
      apply: true,
      destroy: false,
    },
    features: prior.features ?? {
      baseInstall: { slack: false, stripe: false, twenty: false },
      optionalApps: [],
    },
    terraform: prior.terraform ?? {
      stateRecovery: { mode: "state", recoverByTags: false },
    },
  };
}

async function runIdentityProviderOperation(
  action: TenantEntraAction,
  options: IdentityProviderOptions,
): Promise<void> {
  const stage = await resolveStage({ flag: options.stage });
  const directoryId = options.directoryId?.trim() || (await readDirectoryId());
  const identity = getAwsIdentity();
  if (!identity || identity.region === "unknown") {
    throw new Error("Could not resolve AWS identity and region.");
  }
  const stateMachineArn = `arn:aws:states:${identity.region}:${identity.account}:stateMachine:thinkwork-${stage}-deployment-orchestrator`;
  const prior = readPriorControllerInput(stateMachineArn);
  if (
    prior.awsAccountId !== identity.account ||
    prior.awsRegion !== identity.region ||
    prior.environmentName !== stage
  ) {
    throw new Error(
      "AWS identity or stage does not match the deployed controller.",
    );
  }
  const state = readAuthReconciliationState(stage);
  const existing = findExistingConnection(state, directoryId);
  if (action === "create" && existing) {
    throw new Error(
      "This tenant Entra connection already exists; use validate or rotate.",
    );
  }
  if (action !== "create" && !existing) {
    throw new Error(`Tenant Entra connection does not exist for ${action}.`);
  }

  const thinkworkTenantId =
    options.tenantId ??
    existingString(existing, "tenantBindings", 0, "tenantId");
  const clientId = options.clientId ?? existingString(existing, "clientId");
  const displayName =
    options.displayName ??
    existingString(existing, "displayName") ??
    "Microsoft";
  const label =
    options.label ??
    existingString(existing, "tenantBindings", 0, "label") ??
    displayName;
  const hostnames = options.hostname?.length
    ? options.hostname
    : existingStringArray(existing, "tenantBindings", 0, "hostnames");

  let secretArn = existingString(existing, "clientSecretRef");
  const validationSecretArn =
    secretArn ??
    `arn:aws:secretsmanager:${identity.region}:${identity.account}:secret:${buildTenantEntraSecretName(stage, directoryId)}`;
  let connection = buildTenantEntraConnectionMetadata({
    directoryId,
    thinkworkTenantId: required(
      thinkworkTenantId,
      "--tenant-id is required for create",
    ),
    clientId: required(clientId, "--client-id is required for create"),
    clientSecretRef: validationSecretArn,
    displayName: required(displayName, "--display-name is required for create"),
    label: required(label, "--label is required for create"),
    hostnames,
  });
  if (!options.yes) {
    const accepted = await confirm(
      `${action} tenant Microsoft login for ${connection.tenantBindings[0].label} on ${stage}?`,
    );
    if (!accepted) return;
  }
  if (action === "create" || action === "rotate") {
    const clientSecret = await readClientSecret();
    secretArn = writeTenantEntraSecret({
      stage,
      directoryId,
      clientId: required(clientId, "--client-id is required for create"),
      clientSecret,
      ...(action === "rotate" ? { versionStage: "AWSPENDING" as const } : {}),
    });
    connection = buildTenantEntraConnectionMetadata({
      directoryId,
      thinkworkTenantId: connection.tenantBindings[0].tenantId,
      clientId: connection.clientId,
      clientSecretRef: secretArn,
      ...(action === "rotate"
        ? { clientSecretVersionStage: "AWSPENDING" as const }
        : {}),
      displayName: connection.displayName,
      label: connection.tenantBindings[0].label,
      hostnames: connection.tenantBindings[0].hostnames,
    });
  }
  const input = buildIdentityProviderControllerInput({
    prior,
    action,
    connection,
    desiredRevision: Number(state.desiredRevision ?? 0),
  });
  const revision = (input.operation as { revision: number }).revision;
  const executionName =
    `tw-${stage}-idp-${action}-r${revision}-${Date.now()}`.slice(0, 80);
  const executionArn = defaultAws.read([
    "stepfunctions",
    "start-execution",
    "--state-machine-arn",
    stateMachineArn,
    "--name",
    executionName,
    "--input",
    JSON.stringify(input),
    "--query",
    "executionArn",
    "--output",
    "text",
  ]);
  printSuccess(`Started ${executionName}`);
  console.log(`  Execution: ${executionArn}`);
  if (options.wait === false) return;
  await waitForController(executionArn);
}

async function readDirectoryId(): Promise<string> {
  if (!process.stdin.isTTY) {
    throw new Error("--directory-id is required in a non-interactive shell.");
  }
  return input({
    message: "Microsoft Entra directory (tenant) GUID:",
    validate: (value) => value.trim().length > 0 || "Directory ID is required.",
  });
}

async function readClientSecret(): Promise<string> {
  if (process.stdin.isTTY) {
    return password({
      message: "Microsoft Entra application client secret:",
      mask: "*",
      validate: (value) =>
        value.trim().length > 0 || "Client secret is required.",
    });
  }
  const value = readFileSync(0, "utf8").trim();
  if (!value) {
    throw new Error(
      "Client secret is required on stdin for create/rotate; it is intentionally not accepted as an argument.",
    );
  }
  return value;
}

function readPriorControllerInput(
  stateMachineArn: string,
): PriorControllerInput {
  const executions = JSON.parse(
    defaultAws.read([
      "stepfunctions",
      "list-executions",
      "--state-machine-arn",
      stateMachineArn,
      "--status-filter",
      "SUCCEEDED",
      "--max-results",
      "20",
      "--query",
      "executions[].executionArn",
      "--output",
      "json",
    ]),
  ) as string[];
  if (executions.length === 0) {
    throw new Error("No successful deployment controller execution was found.");
  }
  const inputs = executions.map((executionArn) =>
    JSON.parse(
      defaultAws.read([
        "stepfunctions",
        "describe-execution",
        "--execution-arn",
        executionArn,
        "--query",
        "input",
        "--output",
        "text",
      ]),
    ),
  );
  // Explicitly parse every candidate before recovery so malformed/secret-like
  // unknown payload data cannot be forwarded to the new execution.
  inputs.forEach(parsePriorControllerInput);
  return recoverPriorControllerInput(inputs);
}

function readAuthReconciliationState(stage: string): AuthReconciliationState {
  try {
    return JSON.parse(
      defaultAws.read([
        "ssm",
        "get-parameter",
        "--name",
        `/thinkwork/${stage}/auth/reconciliation/state`,
        "--query",
        "Parameter.Value",
        "--output",
        "text",
      ]),
    ) as AuthReconciliationState;
  } catch {
    return {};
  }
}

function findExistingConnection(
  state: AuthReconciliationState,
  directoryId: string,
): Record<string, unknown> | undefined {
  const normalized = directoryId.trim().toLowerCase();
  return state.tenantConnections?.find(
    (value) =>
      value.tenantDirectoryId === normalized ||
      value.connectionKey === `microsoft:tenant:${normalized}`,
  );
}

function existingString(
  value: Record<string, unknown> | undefined,
  ...path: Array<string | number>
): string | undefined {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return undefined;
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return typeof current === "string" ? current : undefined;
}

function existingStringArray(
  value: Record<string, unknown> | undefined,
  ...path: Array<string | number>
): string[] {
  let current: unknown = value;
  for (const key of path) {
    if (current === null || typeof current !== "object") return [];
    current = (current as Record<PropertyKey, unknown>)[key];
  }
  return Array.isArray(current)
    ? current.filter((entry): entry is string => typeof entry === "string")
    : [];
}

function required(value: string | undefined, message: string): string {
  if (!value?.trim()) throw new Error(message);
  return value.trim();
}

async function waitForController(executionArn: string): Promise<void> {
  const deadline = Date.now() + 45 * 60 * 1000;
  process.stdout.write("  Waiting for the controller run");
  while (Date.now() < deadline) {
    await new Promise((resolve) => setTimeout(resolve, 15_000));
    const result = JSON.parse(
      defaultAws.read([
        "stepfunctions",
        "describe-execution",
        "--execution-arn",
        executionArn,
        "--query",
        "{status:status,error:error}",
        "--output",
        "json",
      ]),
    ) as { status: string; error?: string };
    if (result.status === "RUNNING") {
      process.stdout.write(".");
      continue;
    }
    console.log("");
    if (result.status !== "SUCCEEDED") {
      throw new Error(
        `Controller ${result.status}: ${result.error ?? "unknown error"}`,
      );
    }
    printSuccess("Tenant Entra identity-provider operation completed.");
    return;
  }
  throw new Error("Timed out waiting for the deployment controller.");
}
