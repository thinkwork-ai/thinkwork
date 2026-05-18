import { gqlMutate } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printSuccess } from "../../ui.js";
import {
  ClaimVanityEmailDoc,
  ReleaseVanityEmailDoc,
  ToggleEmailDoc,
  UpdateAgentEmailAllowlistDoc,
} from "./gql.js";
import { resolveAgentContext, type AgentCliOptions } from "./helpers.js";

interface EnableOptions extends AgentCliOptions {
  localPart?: string;
}

export async function runAgentEmailEnable(
  agentId: string,
  opts: EnableOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  // Two-step: enable the email channel, then (optionally) claim a vanity addr.
  const toggled = await gqlMutate(ctx.client, ToggleEmailDoc, {
    agentId,
    enabled: true,
  });
  let claimed: unknown = null;
  if (opts.localPart) {
    const r = await gqlMutate(ctx.client, ClaimVanityEmailDoc, {
      agentId,
      localPart: opts.localPart,
    });
    claimed = r.claimVanityEmailAddress;
  }
  if (isJsonMode()) {
    printJson({ enabled: toggled.toggleAgentEmailChannel, claimed });
    return;
  }
  printSuccess(`Enabled email channel for agent ${agentId}.`);
  if (opts.localPart) {
    console.log(`  Claimed vanity local-part: ${opts.localPart}`);
  }
}

export async function runAgentEmailDisable(
  agentId: string,
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  // Release the vanity address (idempotent if none) then disable the channel.
  await gqlMutate(ctx.client, ReleaseVanityEmailDoc, { agentId }).catch(() => undefined);
  const data = await gqlMutate(ctx.client, ToggleEmailDoc, {
    agentId,
    enabled: false,
  });
  if (isJsonMode()) {
    printJson(data.toggleAgentEmailChannel);
    return;
  }
  printSuccess(`Disabled email channel for agent ${agentId}.`);
}

export async function runAgentEmailAllowlist(
  agentId: string,
  senders: string[],
  opts: AgentCliOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);
  const data = await gqlMutate(ctx.client, UpdateAgentEmailAllowlistDoc, {
    agentId,
    allowedSenders: senders,
  });
  if (isJsonMode()) {
    printJson(data.updateAgentEmailAllowlist);
    return;
  }
  printSuccess(
    `Updated email allowlist for agent ${agentId} (${senders.length} sender(s)).`,
  );
}
