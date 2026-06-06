import { rebuildSkillCatalogIndex } from "./rebuildSkillCatalogIndex.mutation.js";
import { tenantSkillCatalog } from "./tenantSkillCatalog.query.js";

export const skillCatalogMutations = {
  rebuildSkillCatalogIndex,
};

export const skillCatalogQueries = {
  tenantSkillCatalog,
};
