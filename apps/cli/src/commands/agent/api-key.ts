import { confirm } from "@inquirer/prompts";
import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isInteractive, promptOrExit, requireTty } from "../../lib/interactive.js";
import { isJsonMode, logStderr, printJson, printTable } from "../../lib/output.js";
import { printError, printSuccess, printWarning } from "../../ui.js";
import {
  AgentApiKeysDoc,
  CreateAgentApiKeyDoc,
  RevokeAgentApiKeyDoc,
} from "./gql.js";
import { resolveAgentContext, fmtIso, type AgentCliOptions } from "./helpers.js";

export async function runAgentApiKeyList(
  agentId: string,
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const data = await gqlQuery(ctx.client, AgentApiKeysDoc, { agentId });
  const items = data.agentApiKeys ?? [];
  if (isJsonMode()) {
    printJson({ items });
    return;
  }
  printTable(
    items.map((k) => ({
      id: k.id,
      name: k.name ?? "—",
      prefix: k.keyPrefix,
      lastUsed: fmtIso(k.lastUsedAt),
      revoked: fmtIso(k.revokedAt),
      created: fmtIso(k.createdAt),
    })),
    [
      { key: "id", header: "ID" },
      { key: "name", header: "NAME" },
      { key: "prefix", header: "PREFIX" },
      { key: "lastUsed", header: "LAST USED" },
      { key: "revoked", header: "REVOKED" },
      { key: "created", header: "CREATED" },
    ],
  );
}

interface CreateOptions extends AgentCliOptions {
  name?: string;
  expires?: string;
}

export async function runAgentApiKeyCreate(
  agentId: string,
  opts: CreateOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);

  if (opts.expires) {
    printWarning(
      "--expires is currently a no-op; AgentApiKey rows have no expiration field. Tracked separately if added.",
    );
  }

  const data = await gqlMutate(ctx.client, CreateAgentApiKeyDoc, {
    input: { agentId, name: opts.name ?? null },
  });
  const result = data.createAgentApiKey;

  if (isJsonMode()) {
    printJson(result);
    return;
  }
  printSuccess(`Created API key ${result.apiKey.id} for agent ${agentId}.`);
  console.log("");
  console.log("  Plaintext secret (SHOWN ONCE — save it now):");
  console.log(`    ${result.plainTextKey}`);
  console.log("");
  console.log(`  Prefix: ${result.apiKey.keyPrefix}`);
}

interface RevokeOptions extends AgentCliOptions {
  yes?: boolean;
}

export async function runAgentApiKeyRevoke(
  keyId: string,
  opts: RevokeOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  if (!opts.yes) {
    if (!isInteractive()) {
      printError("Refusing to revoke without --yes in a non-interactive session.");
      process.exit(1);
    }
    requireTty("Confirmation");
    const go = await promptOrExit(() =>
      confirm({
        message: `Revoke API key ${keyId}? Subsequent requests return 401.`,
        default: false,
      }),
    );
    if (!go) {
      logStderr("Cancelled.");
      process.exit(0);
    }
  }
  const data = await gqlMutate(ctx.client, RevokeAgentApiKeyDoc, { id: keyId });
  if (isJsonMode()) {
    printJson(data.revokeAgentApiKey);
    return;
  }
  printSuccess(`Revoked API key ${keyId} at ${fmtIso(data.revokeAgentApiKey.revokedAt)}.`);
}
