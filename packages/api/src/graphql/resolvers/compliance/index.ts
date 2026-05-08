import {
	complianceEvent,
	complianceEventByHash,
	complianceEvents,
	complianceOperatorCheck,
	complianceTenants,
} from "./query.js";
import {
	complianceExports,
	createComplianceExport,
} from "./exports.js";

export const complianceQueries = {
	complianceEvents,
	complianceEvent,
	complianceEventByHash,
	complianceTenants,
	complianceOperatorCheck,
	complianceExports,
};

export const complianceMutations = {
	createComplianceExport,
};
