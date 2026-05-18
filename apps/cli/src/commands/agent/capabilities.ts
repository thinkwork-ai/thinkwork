import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { AgentDoc, SetAgentCapabilitiesDoc } from "./gql.js";
import { resolveAgentContext, type AgentCliOptions } from "./helpers.js";

interface SetOptions extends AgentCliOptions {
  capability?: string;
  enabled?: boolean;
  disabled?: boolean;
}

/**
 * The API exposes setAgentCapabilities as a bulk-replace mutation, so to
 * change one capability we read the agent's current list, modify in place
 * (or insert), and rewrite. Same read-modify-write pattern as kb attach.
 */
export async function runAgentCapabilitiesSet(
  agentId: string,
  opts: SetOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);

  if (!opts.capability) {
    printError("--capability <name> is required.");
    process.exit(1);
  }
  if (!opts.enabled && !opts.disabled) {
    printError("Pass either --enabled or --disabled.");
    process.exit(1);
  }
  const enabled = !!opts.enabled && !opts.disabled;

  const current = await gqlQuery(ctx.client, AgentDoc, { id: agentId });
  if (!current.agent) {
    printError(`Agent ${agentId} not found.`);
    process.exit(1);
  }

  const existing = current.agent.capabilities ?? [];
  const filtered = existing.filter((c) => c.capability !== opts.capability);
  const next = [
    ...filtered.map((c) => ({
      capability: c.capability,
      enabled: c.enabled,
      config: c.config ?? null,
    })),
    { capability: opts.capability!, enabled, config: null },
  ];

  const data = await gqlMutate(ctx.client, SetAgentCapabilitiesDoc, {
    agentId,
    capabilities: next,
  });

  if (isJsonMode()) {
    printJson({ agentId, capability: opts.capability, enabled, after: data.setAgentCapabilities });
    return;
  }
  printSuccess(
    `${enabled ? "Enabled" : "Disabled"} capability "${opts.capability}" on agent ${agentId}.`,
  );
}
