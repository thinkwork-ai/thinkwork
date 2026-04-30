import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createSupportCaseContextProvider() {
	return createSubAgentContextProvider({
		id: "support-case",
		displayName: "Support Case Context",
		promptRef: "brain/provider/support-case",
		toolAllowlist: ["support.case.read"],
		depthCap: 2,
	});
}
