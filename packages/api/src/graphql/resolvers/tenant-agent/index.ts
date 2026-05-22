import { modelCatalog } from "./modelCatalog.query.js";
import { tenantAgent } from "./tenantAgent.query.js";
import { updateTenantAgent } from "./updateTenantAgent.mutation.js";

export const tenantAgentQueries = {
  modelCatalog,
  tenantAgent,
};

export const tenantAgentMutations = {
  updateTenantAgent,
};

export { agentTypeResolvers } from "./types.js";
