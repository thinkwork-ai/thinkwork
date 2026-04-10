// Queries
import { agentTemplates_query } from "./agentTemplates.query.js";
import { agentTemplate } from "./agentTemplate.query.js";
import { linkedAgentsForTemplate } from "./linkedAgentsForTemplate.query.js";
import { templateSyncDiff } from "./templateSyncDiff.query.js";
import { agentVersionsList } from "./agentVersions.query.js";

// Mutations
import { createAgentTemplate } from "./createAgentTemplate.mutation.js";
import { updateAgentTemplate } from "./updateAgentTemplate.mutation.js";
import { deleteAgentTemplate } from "./deleteAgentTemplate.mutation.js";
import { createAgentFromTemplate } from "./createAgentFromTemplate.mutation.js";
import { syncTemplateToAgent } from "./syncTemplateToAgent.mutation.js";
import { syncTemplateToAllAgents } from "./syncTemplateToAllAgents.mutation.js";
import { rollbackAgentVersion } from "./rollbackAgentVersion.mutation.js";

export const templateQueries = {
	agentTemplates: agentTemplates_query,
	agentTemplate,
	linkedAgentsForTemplate,
	templateSyncDiff,
	agentVersions: agentVersionsList,
};

export const templateMutations = {
	createAgentTemplate,
	updateAgentTemplate,
	deleteAgentTemplate,
	createAgentFromTemplate,
	syncTemplateToAgent,
	syncTemplateToAllAgents,
	rollbackAgentVersion,
};
