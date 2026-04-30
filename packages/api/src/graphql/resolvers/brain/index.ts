import { tenantEntityPage } from "./tenantEntityPage.query.js";
import { tenantEntityFacets } from "./tenantEntityFacets.query.js";
import { editTenantEntityFact } from "./editTenantEntityFact.mutation.js";
import { rejectTenantEntityFact } from "./rejectTenantEntityFact.mutation.js";

export const brainQueries = {
	tenantEntityPage,
	tenantEntityFacets,
};

export const brainMutations = {
	editTenantEntityFact,
	rejectTenantEntityFact,
};
