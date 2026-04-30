import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createSupportCaseContextProvider() {
	return createSubAgentContextProvider({
		id: "support-case",
		displayName: "Support Case Context",
		promptRef: "brain/provider/support-case",
		prompt: {
			title: "Support case specialist",
			summary:
				"Find support history, incidents, and case evidence once the connector is wired.",
		},
		resources: [
			{
				id: "support-cases",
				label: "Support cases",
				type: "Support connector",
				description: "Tickets, incidents, case comments, status, and resolution notes.",
				access: "read",
			},
		],
		skills: [
			{
				id: "case-thread-navigation",
				label: "Case thread navigation",
				description:
					"Follow case timelines and comments to extract relevant customer context.",
			},
		],
		toolAllowlist: ["support.case.read"],
		depthCap: 2,
	});
}
