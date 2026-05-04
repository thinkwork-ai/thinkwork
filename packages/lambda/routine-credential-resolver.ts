import {
  GetSecretValueCommand,
  SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import { and, eq, inArray, or } from "drizzle-orm";
import { getDb, schema } from "@thinkwork/database-pg";
import { collectSecretLeafValues } from "./routine-output-redactor.js";

export interface CredentialBindingInput {
  alias: string;
  credentialId: string;
  requiredFields?: string[];
}

export interface ResolvedRoutineCredentials {
  credentials: Record<string, Record<string, unknown>>;
  redactionValues: string[];
  credentialIds: string[];
}

export interface ResolveRoutineCredentialBindingsInput {
  tenantId: string;
  bindings: CredentialBindingInput[];
  secretsManager: SecretsManagerClient;
  database?: ReturnType<typeof getDb>;
  now?: () => Date;
}

interface TenantCredentialRuntimeRow {
  id: string;
  tenant_id: string;
  slug: string;
  display_name: string;
  status: string;
  secret_ref: string;
}

const { tenantCredentials } = schema;

const ALIAS_RE = /^[A-Za-z_][A-Za-z0-9_]*$/;
const UUID_HANDLE_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export async function resolveRoutineCredentialBindings(
  input: ResolveRoutineCredentialBindingsInput,
): Promise<ResolvedRoutineCredentials> {
  const bindings = normalizeBindings(input.bindings);
  if (bindings.length === 0) {
    return { credentials: {}, redactionValues: [], credentialIds: [] };
  }

  const rows = await loadCredentialRows(
    input.tenantId,
    bindings,
    input.database,
  );
  const byHandle = new Map<string, TenantCredentialRuntimeRow>();
  for (const row of rows) {
    byHandle.set(row.id, row);
    byHandle.set(row.slug, row);
  }

  const credentials: Record<string, Record<string, unknown>> = {};
  const credentialIds: string[] = [];
  const secretPayloads: Record<string, unknown>[] = [];
  for (const binding of bindings) {
    const credential = byHandle.get(binding.credentialId);
    if (!credential) {
      throw new Error(
        `Credential '${binding.credentialId}' was not found for this tenant`,
      );
    }
    if (
      credential.tenant_id !== input.tenantId ||
      credential.status !== "active"
    ) {
      throw new Error(
        `Credential '${credential.display_name}' is not active for this tenant`,
      );
    }

    const payload = await readCredentialSecret(
      input.secretsManager,
      credential.secret_ref,
      credential.display_name,
    );
    validateRequiredFields(binding, credential, payload);
    credentials[binding.alias] = payload;
    secretPayloads.push(payload);
    credentialIds.push(credential.id);
  }

  await markCredentialsUsed(
    input.tenantId,
    credentialIds,
    input.database,
    input.now ?? (() => new Date()),
  );

  return {
    credentials,
    credentialIds,
    redactionValues: Array.from(
      new Set(
        secretPayloads.flatMap((payload) => collectSecretLeafValues(payload)),
      ),
    ),
  };
}

function normalizeBindings(
  bindings: CredentialBindingInput[],
): CredentialBindingInput[] {
  const seenAliases = new Set<string>();
  return bindings.map((binding) => {
    const alias = String(binding.alias ?? "").trim();
    if (!ALIAS_RE.test(alias)) {
      throw new Error(
        `Credential alias '${alias}' must be a safe code identifier`,
      );
    }
    if (seenAliases.has(alias)) {
      throw new Error(`Credential alias '${alias}' is declared more than once`);
    }
    seenAliases.add(alias);
    const credentialId = String(binding.credentialId ?? "").trim();
    if (!credentialId) {
      throw new Error(`Credential binding '${alias}' is missing credentialId`);
    }
    return {
      alias,
      credentialId,
      requiredFields: Array.isArray(binding.requiredFields)
        ? binding.requiredFields
            .map((field) => String(field).trim())
            .filter(Boolean)
        : [],
    };
  });
}

async function loadCredentialRows(
  tenantId: string,
  bindings: CredentialBindingInput[],
  database: ReturnType<typeof getDb> = getDb(),
): Promise<TenantCredentialRuntimeRow[]> {
  const handles = Array.from(
    new Set(bindings.map((binding) => binding.credentialId)),
  );
  const uuidHandles = handles.filter((handle) => UUID_HANDLE_RE.test(handle));
  const slugHandles = handles.filter((handle) => !UUID_HANDLE_RE.test(handle));
  const handleFilter =
    uuidHandles.length > 0 && slugHandles.length > 0
      ? or(
          inArray(tenantCredentials.id, uuidHandles),
          inArray(tenantCredentials.slug, slugHandles),
        )
      : uuidHandles.length > 0
        ? inArray(tenantCredentials.id, uuidHandles)
        : inArray(tenantCredentials.slug, slugHandles);

  return (await database
    .select({
      id: tenantCredentials.id,
      tenant_id: tenantCredentials.tenant_id,
      slug: tenantCredentials.slug,
      display_name: tenantCredentials.display_name,
      status: tenantCredentials.status,
      secret_ref: tenantCredentials.secret_ref,
    })
    .from(tenantCredentials)
    .where(
      and(eq(tenantCredentials.tenant_id, tenantId), handleFilter),
    )) as TenantCredentialRuntimeRow[];
}

async function readCredentialSecret(
  secretsManager: SecretsManagerClient,
  secretRef: string,
  displayName: string,
): Promise<Record<string, unknown>> {
  try {
    const result = await secretsManager.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    if (!result.SecretString) {
      throw new Error("empty SecretString");
    }
    const parsed = JSON.parse(result.SecretString) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      throw new Error("SecretString must be a JSON object");
    }
    return parsed as Record<string, unknown>;
  } catch (err) {
    const reason = safeCredentialReadFailureReason(err);
    throw new Error(`Failed to read credential '${displayName}': ${reason}`);
  }
}

function safeCredentialReadFailureReason(err: unknown): string {
  const message = (err as { message?: string })?.message ?? "";
  if (message === "empty SecretString") return message;
  if (message === "SecretString must be a JSON object") return message;
  return (err as { name?: string })?.name ?? "Secrets Manager error";
}

function validateRequiredFields(
  binding: CredentialBindingInput,
  credential: TenantCredentialRuntimeRow,
  payload: Record<string, unknown>,
): void {
  for (const field of binding.requiredFields ?? []) {
    const value = payload[field];
    if (value === undefined || value === null || value === "") {
      throw new Error(
        `Credential '${credential.display_name}' is missing required field '${field}'`,
      );
    }
  }
}

async function markCredentialsUsed(
  tenantId: string,
  credentialIds: string[],
  database: ReturnType<typeof getDb> = getDb(),
  now: () => Date,
): Promise<void> {
  if (credentialIds.length === 0) return;
  const timestamp = now();
  await database
    .update(tenantCredentials)
    .set({ last_used_at: timestamp, updated_at: timestamp })
    .where(
      and(
        eq(tenantCredentials.tenant_id, tenantId),
        inArray(tenantCredentials.id, credentialIds),
      ),
    );
}
