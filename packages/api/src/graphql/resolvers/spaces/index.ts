import { customerOnboardingSpace } from "./customerOnboardingSpace.query.js";
import { space } from "./space.query.js";
import { spaces } from "./spaces.query.js";
import { startCustomerOnboarding } from "./startCustomerOnboarding.mutation.js";

export const spaceQueries = {
  customerOnboardingSpace,
  space,
  spaces,
};

export const spaceMutations = {
  startCustomerOnboarding,
};

export {
  spaceAgentAssignmentTypeResolvers,
  spaceChecklistTemplateTypeResolvers,
  spaceMemberTypeResolvers,
  spaceTypeResolvers,
} from "./types.js";
