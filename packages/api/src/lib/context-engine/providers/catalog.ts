import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createCatalogContextProvider() {
	return createSubAgentContextProvider({
		id: "catalog",
		displayName: "Catalog Context",
		promptRef: "brain/provider/catalog",
		toolAllowlist: ["catalog.item.read"],
		depthCap: 2,
	});
}
