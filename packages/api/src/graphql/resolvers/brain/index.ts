import { tenantEntityPage } from "./tenantEntityPage.query.js";
import { tenantEntityFacets } from "./tenantEntityFacets.query.js";
import { brainEnrichmentSources } from "./brainEnrichmentSources.query.js";
import { editTenantEntityFact } from "./editTenantEntityFact.mutation.js";
import { rejectTenantEntityFact } from "./rejectTenantEntityFact.mutation.js";
import { runBrainPageEnrichment } from "./runBrainPageEnrichment.mutation.js";

export const brainQueries = {
  tenantEntityPage,
  tenantEntityFacets,
  brainEnrichmentSources,
};

export const brainMutations = {
  editTenantEntityFact,
  rejectTenantEntityFact,
  runBrainPageEnrichment,
};
