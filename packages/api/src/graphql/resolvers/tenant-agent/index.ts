import { myApprovedModelCatalog } from "./myApprovedModelCatalog.query.js";
import { modelCatalog } from "./modelCatalog.query.js";
import { setUserModelApproval } from "./setUserModelApproval.mutation.js";
import { tenantAgent } from "./tenantAgent.query.js";
import { updateTenantAgent } from "./updateTenantAgent.mutation.js";
import { userModelCatalog } from "./userModelCatalog.query.js";

export const tenantAgentQueries = {
  myApprovedModelCatalog,
  modelCatalog,
  tenantAgent,
  userModelCatalog,
};

export const tenantAgentMutations = {
  setUserModelApproval,
  updateTenantAgent,
};

export { agentTypeResolvers } from "./types.js";
