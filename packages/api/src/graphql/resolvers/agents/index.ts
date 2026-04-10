// Queries
import { agents } from "./agents.query.js";
import { agent } from "./agent.query.js";
import { agentApiKeys } from "./agentApiKeys.query.js";
import { agentEmailCapability } from "./agentEmailCapability.query.js";
import { modelCatalog } from "./modelCatalog.query.js";
import { agentWorkspaces } from "./agentWorkspaces.query.js";

// Mutations
import { createAgent } from "./createAgent.mutation.js";
import { updateAgent } from "./updateAgent.mutation.js";
import { deleteAgent } from "./deleteAgent.mutation.js";
import { updateAgentStatus } from "./updateAgentStatus.mutation.js";
import { setAgentCapabilities } from "./setAgentCapabilities.mutation.js";
import { setAgentSkills } from "./setAgentSkills.mutation.js";
import { setAgentBudgetPolicy } from "./setAgentBudgetPolicy.mutation.js";
import { deleteAgentBudgetPolicy } from "./deleteAgentBudgetPolicy.mutation.js";
import { createAgentApiKey } from "./createAgentApiKey.mutation.js";
import { revokeAgentApiKey } from "./revokeAgentApiKey.mutation.js";
import { updateAgentEmailAllowlist } from "./updateAgentEmailAllowlist.mutation.js";
import { toggleAgentEmailChannel } from "./toggleAgentEmailChannel.mutation.js";
import { claimVanityEmailAddress } from "./claimVanityEmailAddress.mutation.js";
import { releaseVanityEmailAddress } from "./releaseVanityEmailAddress.mutation.js";

export const agentQueries = { agents, agent, agentWorkspaces, agentApiKeys, agentEmailCapability, modelCatalog };

export const agentMutations = {
	createAgent,
	updateAgent,
	deleteAgent,
	updateAgentStatus,
	setAgentCapabilities,
	setAgentSkills,
	setAgentBudgetPolicy,
	deleteAgentBudgetPolicy,
	createAgentApiKey,
	revokeAgentApiKey,
	updateAgentEmailAllowlist,
	toggleAgentEmailChannel,
	claimVanityEmailAddress,
	releaseVanityEmailAddress,
};
