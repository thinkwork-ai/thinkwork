import { createSubAgentContextProvider } from "./sub-agent-base.js";

export function createErpCustomerContextProvider() {
	return createSubAgentContextProvider({
		id: "erp-customer",
		displayName: "ERP Customer Context",
		promptRef: "brain/provider/erp-customer",
		prompt: {
			title: "ERP customer specialist",
			summary:
				"Resolve customer/account context from ERP records once the connector is wired.",
		},
		resources: [
			{
				id: "erp-customers",
				label: "ERP customer records",
				type: "ERP connector",
				description: "Customer master data, account status, and billing context.",
				access: "read",
			},
		],
		skills: [
			{
				id: "customer-disambiguation",
				label: "Customer disambiguation",
				description:
					"Resolve ambiguous customer names and map them to canonical ERP accounts.",
			},
		],
		toolAllowlist: ["erp.customer.read"],
		depthCap: 2,
	});
}
