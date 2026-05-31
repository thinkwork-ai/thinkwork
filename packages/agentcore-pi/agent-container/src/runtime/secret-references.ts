import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { GetParameterCommand, SSMClient } from "@aws-sdk/client-ssm";

export interface RuntimeSecretGrant {
  ref: string;
  tenantId: string;
  userId?: string | null;
}

export interface RuntimeSsmClient {
  send(command: GetParameterCommand): Promise<{
    Parameter?: { Value?: string };
  }>;
}

export interface RuntimeSecretsManagerClient {
  send(command: GetSecretValueCommand): Promise<{
    SecretString?: string;
    SecretBinary?: Uint8Array | string;
  }>;
}

export interface ResolveRuntimeSecretReferenceInput {
  ref: string;
  tenantId: string;
  userId?: string | null;
  stage: string;
  region: string;
  accountId: string;
  grants: RuntimeSecretGrant[];
  ssmClient?: RuntimeSsmClient;
  secretsManagerClient?: RuntimeSecretsManagerClient;
}

export class SecretReferenceError extends Error {
  constructor(
    message: string,
    public readonly code:
      | "INVALID_SECRET_REFERENCE"
      | "SECRET_GRANT_REQUIRED"
      | "SECRET_REFERENCE_UNAPPROVED"
      | "SECRET_NOT_FOUND",
  ) {
    super(message);
    this.name = "SecretReferenceError";
  }
}

export async function resolveRuntimeSecretReference(
  input: ResolveRuntimeSecretReferenceInput,
): Promise<string> {
  const parsed = parseSecretReference(input.ref);
  assertSecretGrant(input, parsed.grantRef);

  if (parsed.kind === "alias") {
    const parameterName = tenantSecretAliasParameterName({
      stage: input.stage,
      tenantId: input.tenantId,
      alias: parsed.alias,
    });
    const ssm =
      input.ssmClient ??
      (new SSMClient({ region: input.region }) as RuntimeSsmClient);
    const parameter = await ssm.send(
      new GetParameterCommand({ Name: parameterName, WithDecryption: true }),
    );
    const value = parameter.Parameter?.Value?.trim();
    if (!value) {
      throw new SecretReferenceError(
        "Secret alias did not resolve to a value.",
        "SECRET_NOT_FOUND",
      );
    }
    if (value.startsWith("arn:")) {
      assertApprovedSecretArn({ ...input, arn: value });
      return readSecretString({ ...input, secretId: value });
    }
    return value;
  }

  assertApprovedSecretArn({ ...input, arn: parsed.arn });
  return readSecretString({ ...input, secretId: parsed.arn });
}

export function tenantSecretAliasParameterName(input: {
  stage: string;
  tenantId: string;
  alias: string;
}): string {
  return `/thinkwork/${input.stage}/tenants/${input.tenantId}/secrets/${input.alias}`;
}

function parseSecretReference(
  ref: string,
):
  | { kind: "alias"; alias: string; grantRef: string }
  | { kind: "arn"; arn: string; grantRef: string } {
  const trimmed = ref.trim();
  if (trimmed.startsWith("secret://")) {
    const alias = trimmed.slice("secret://".length);
    if (
      !/^[A-Za-z0-9][A-Za-z0-9._/-]{0,127}$/.test(alias) ||
      alias.includes("..") ||
      alias.startsWith("/") ||
      alias.endsWith("/")
    ) {
      throw new SecretReferenceError(
        "Secret alias is not canonical.",
        "INVALID_SECRET_REFERENCE",
      );
    }
    return { kind: "alias", alias, grantRef: `secret://${alias}` };
  }

  if (trimmed.startsWith("arn:aws:secretsmanager:")) {
    return { kind: "arn", arn: trimmed, grantRef: trimmed };
  }

  throw new SecretReferenceError(
    "Secret references must use secret:// aliases or approved Secrets Manager ARNs.",
    "INVALID_SECRET_REFERENCE",
  );
}

function assertSecretGrant(
  input: ResolveRuntimeSecretReferenceInput,
  grantRef: string,
): void {
  const allowed = input.grants.some(
    (grant) =>
      grant.tenantId === input.tenantId &&
      grant.ref === grantRef &&
      (!grant.userId || grant.userId === input.userId),
  );
  if (!allowed) {
    throw new SecretReferenceError(
      "Secret reference is not granted to this runtime.",
      "SECRET_GRANT_REQUIRED",
    );
  }
}

function assertApprovedSecretArn(
  input: ResolveRuntimeSecretReferenceInput & {
    arn: string;
  },
): void {
  const approvedPrefix = `arn:aws:secretsmanager:${input.region}:${input.accountId}:secret:thinkwork/${input.stage}/tenants/${input.tenantId}/`;
  if (!input.arn.startsWith(approvedPrefix)) {
    throw new SecretReferenceError(
      "Raw Secrets Manager ARN is outside the approved tenant/stage/account prefix.",
      "SECRET_REFERENCE_UNAPPROVED",
    );
  }
}

async function readSecretString(
  input: ResolveRuntimeSecretReferenceInput & { secretId: string },
): Promise<string> {
  const sm =
    input.secretsManagerClient ??
    (new SecretsManagerClient({
      region: input.region,
    }) as RuntimeSecretsManagerClient);
  const secret = await sm.send(
    new GetSecretValueCommand({ SecretId: input.secretId }),
  );
  if (secret.SecretString) return secret.SecretString;
  if (secret.SecretBinary) {
    return Buffer.from(secret.SecretBinary).toString("utf8");
  }
  throw new SecretReferenceError(
    "Secrets Manager returned an empty secret.",
    "SECRET_NOT_FOUND",
  );
}
