import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createCrmOpportunityContextProvider() {
	return createSubAgentContextProvider({
		id: "crm-opportunity",
		displayName: "CRM Opportunity Context",
		promptRef: "brain/provider/crm-opportunity",
		prompt: {
			title: "CRM opportunity specialist",
			summary:
				"Find pipeline, account, and deal context from CRM records once the connector is wired.",
		},
		resources: [
			{
				id: "crm-opportunities",
				label: "CRM opportunities",
				type: "CRM connector",
				description: "Deals, stages, contacts, notes, and pipeline activity.",
				access: "read",
			},
		],
		skills: [
			{
				id: "opportunity-context",
				label: "Opportunity context",
				description:
					"Connect company, contact, and deal terms to the right CRM opportunity.",
			},
		],
		toolAllowlist: ["crm.opportunity.read"],
		depthCap: 2,
	});
}
