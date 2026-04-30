import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createErpCustomerContextProvider() {
	return createSubAgentContextProvider({
		id: "erp-customer",
		displayName: "ERP Customer Context",
		promptRef: "brain/provider/erp-customer",
		toolAllowlist: ["erp.customer.read"],
		depthCap: 2,
	});
}
