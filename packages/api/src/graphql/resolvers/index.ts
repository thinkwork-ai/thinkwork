import { agentQueries } from "./agents/index.js";
import { coreQueries } from "./core/index.js";
import { hiveQueries } from "./hives/index.js";
import { threadQueries } from "./threads/index.js";
import { inboxQueries } from "./inbox/index.js";
import { triggerQueries } from "./triggers/index.js";
import { costQueries } from "./costs/index.js";
import { knowledgeQueries } from "./knowledge/index.js";
import { artifactQueries } from "./artifacts/index.js";
import { orchestrationQueries } from "./orchestration/index.js";
import { messageQueries } from "./messages/index.js";
import { webhookQueries } from "./webhooks/index.js";
import { observabilityQueries } from "./observability/index.js";
import { memoryQueries, memoryMutations } from "./memory/index.js";
import { quickActionQueries, quickActionMutations } from "./quick-actions/index.js";
import { recipeQueries, recipeMutations } from "./recipes/index.js";
import { templateQueries, templateMutations } from "./templates/index.js";
import { agentMutations } from "./agents/index.js";
import { coreMutations } from "./core/index.js";
import { messageMutations } from "./messages/index.js";
import { hiveMutations } from "./hives/index.js";
import { triggerMutations } from "./triggers/index.js";
import { threadMutations } from "./threads/index.js";
import { inboxMutations } from "./inbox/index.js";
import { costMutations } from "./costs/index.js";
import { knowledgeMutations } from "./knowledge/index.js";
import { artifactMutations } from "./artifacts/index.js";
import { orchestrationMutations } from "./orchestration/index.js";
import { webhookMutations } from "./webhooks/index.js";

export const queryResolvers: Record<string, any> = {
	_empty: () => null,
	...agentQueries,
	...coreQueries,
	...hiveQueries,
	...threadQueries,
	...inboxQueries,
	...triggerQueries,
	...costQueries,
	...knowledgeQueries,
	...artifactQueries,
	...orchestrationQueries,
	...messageQueries,
	...webhookQueries,
	...observabilityQueries,
	...memoryQueries,
	...quickActionQueries,
	...recipeQueries,
	...templateQueries,
};

export const mutationResolvers: Record<string, any> = {
	_empty: () => null,
	...agentMutations,
	...coreMutations,
	...messageMutations,
	...hiveMutations,
	...triggerMutations,
	...threadMutations,
	...inboxMutations,
	...costMutations,
	...knowledgeMutations,
	...artifactMutations,
	...orchestrationMutations,
	...webhookMutations,
	...memoryMutations,
	...quickActionMutations,
	...recipeMutations,
	...templateMutations,
};

import { agentTypeResolvers } from "./agents/types.js";
import { threadTypeResolvers } from "./threads/types.js";

export const typeResolvers: Record<string, Record<string, any>> = {
	Agent: agentTypeResolvers,
	Thread: threadTypeResolvers,
};
