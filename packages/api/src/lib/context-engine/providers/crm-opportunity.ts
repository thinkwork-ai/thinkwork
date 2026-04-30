import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createCrmOpportunityContextProvider() {
	return createSubAgentContextProvider({
		id: "crm-opportunity",
		displayName: "CRM Opportunity Context",
		promptRef: "brain/provider/crm-opportunity",
		toolAllowlist: ["crm.opportunity.read"],
		depthCap: 2,
	});
}
