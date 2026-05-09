import { connectorCatalog } from "./connectorCatalog.query.js";
import { customizeBindings } from "./customizeBindings.query.js";
import { disableConnector } from "./disableConnector.mutation.js";
import { disableSkill } from "./disableSkill.mutation.js";
import { enableConnector } from "./enableConnector.mutation.js";
import { enableSkill } from "./enableSkill.mutation.js";
import { skillCatalog } from "./skillCatalog.query.js";
import { workflowCatalog } from "./workflowCatalog.query.js";

export const customizeQueries = {
  connectorCatalog,
  customizeBindings,
  skillCatalog,
  workflowCatalog,
};

export const customizeMutations = {
  enableConnector,
  disableConnector,
  enableSkill,
  disableSkill,
};
