import { gqlMutate, gqlQuery } from "../../lib/gql-client.js";
import { isJsonMode, printJson } from "../../lib/output.js";
import { printError, printSuccess } from "../../ui.js";
import { AgentDoc, SetAgentSkillsDoc } from "./gql.js";
import { resolveAgentContext, type AgentCliOptions } from "./helpers.js";

interface SetOptions extends AgentCliOptions {
  skill?: string;
  enabled?: boolean;
  disabled?: boolean;
  config?: string;
  rateLimit?: string;
}

export async function runAgentSkillsSet(
  agentId: string,
  opts: SetOptions,
): Promise<void> {
  const ctx = await resolveAgentContext(opts);

  if (!opts.skill) {
    printError("--skill <id> is required.");
    process.exit(1);
  }
  if (!opts.enabled && !opts.disabled) {
    printError("Pass either --enabled or --disabled.");
    process.exit(1);
  }
  const enabled = !!opts.enabled && !opts.disabled;

  let configJson: unknown = null;
  if (opts.config) {
    try {
      configJson = JSON.parse(opts.config);
    } catch (err) {
      printError(`--config is not valid JSON: ${(err as Error).message}`);
      process.exit(1);
    }
  }
  const rateLimitRpm =
    opts.rateLimit !== undefined ? Number.parseInt(opts.rateLimit, 10) : null;

  const current = await gqlQuery(ctx.client, AgentDoc, { id: agentId });
  if (!current.agent) {
    printError(`Agent ${agentId} not found.`);
    process.exit(1);
  }

  const existing = current.agent.skills ?? [];
  const filtered = existing.filter((s) => s.skillId !== opts.skill);
  const next = [
    ...filtered.map((s) => ({
      skillId: s.skillId,
      enabled: s.enabled,
      rateLimitRpm: s.rateLimitRpm,
    })),
    {
      skillId: opts.skill!,
      enabled,
      config: configJson,
      rateLimitRpm,
    },
  ];

  const data = await gqlMutate(ctx.client, SetAgentSkillsDoc, {
    agentId,
    skills: next,
  });

  if (isJsonMode()) {
    printJson({ agentId, skill: opts.skill, enabled, after: data.setAgentSkills });
    return;
  }
  printSuccess(
    `${enabled ? "Enabled" : "Disabled"} skill "${opts.skill}" on agent ${agentId}.`,
  );
}
