import { agentProfile } from "./agentProfile.query.js";
import { agentProfileEditorCatalog } from "./agentProfileEditorCatalog.query.js";
import { agentProfiles } from "./agentProfiles.query.js";
import { createAgentProfile } from "./createAgentProfile.mutation.js";
import { deleteAgentProfile } from "./deleteAgentProfile.mutation.js";
import { updateAgentProfile } from "./updateAgentProfile.mutation.js";

export const agentProfileQueries = {
  agentProfile,
  agentProfileEditorCatalog,
  agentProfiles,
};

export const agentProfileMutations = {
  createAgentProfile,
  deleteAgentProfile,
  updateAgentProfile,
};

export {
  agentProfileSpaceAssignmentTypeResolvers,
  agentProfileTypeResolvers,
} from "./types.js";
