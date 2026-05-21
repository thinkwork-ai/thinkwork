import { customerOnboardingSpace } from "./customerOnboardingSpace.query.js";
import { createSpace } from "./createSpace.mutation.js";
import { setSpaceAgentAvailability } from "./setSpaceAgentAvailability.mutation.js";
import { setSpaceKnowledgeBases } from "./setSpaceKnowledgeBases.mutation.js";
import { space } from "./space.query.js";
import { spaces } from "./spaces.query.js";
import { startCustomerOnboarding } from "./startCustomerOnboarding.mutation.js";
import { updateSpace } from "./updateSpace.mutation.js";

export const spaceQueries = {
  customerOnboardingSpace,
  space,
  spaces,
};

export const spaceMutations = {
  createSpace,
  setSpaceAgentAvailability,
  setSpaceKnowledgeBases,
  startCustomerOnboarding,
  updateSpace,
};

export {
  spaceAgentAssignmentTypeResolvers,
  spaceChecklistTemplateTypeResolvers,
  spaceMemberTypeResolvers,
  spaceMcpServerTypeResolvers,
  spaceTypeResolvers,
} from "./types.js";
