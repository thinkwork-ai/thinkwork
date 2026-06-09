import { bedrockModelImportCandidates } from "./bedrockModelImportCandidates.query.js";
import { importTenantBedrockModels } from "./importTenantBedrockModels.mutation.js";
import { myApprovedModelCatalog } from "./myApprovedModelCatalog.query.js";
import { modelCatalog } from "./modelCatalog.query.js";
import { setUserModelApproval } from "./setUserModelApproval.mutation.js";
import { tenantAgent } from "./tenantAgent.query.js";
import { tenantModelCatalog } from "./tenantModelCatalog.query.js";
import { updateTenantAgent } from "./updateTenantAgent.mutation.js";
import { updateTenantModelCatalogEntry } from "./updateTenantModelCatalogEntry.mutation.js";
import { userModelCatalog } from "./userModelCatalog.query.js";

export const tenantAgentQueries = {
  bedrockModelImportCandidates,
  myApprovedModelCatalog,
  modelCatalog,
  tenantAgent,
  tenantModelCatalog,
  userModelCatalog,
};

export const tenantAgentMutations = {
  importTenantBedrockModels,
  setUserModelApproval,
  updateTenantAgent,
  updateTenantModelCatalogEntry,
};

export { agentTypeResolvers } from "./types.js";
