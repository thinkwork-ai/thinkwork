import { customerOnboardingSpace } from "./customerOnboardingSpace.query.js";
import { space } from "./space.query.js";
import { spaces } from "./spaces.query.js";

export const spaceQueries = {
  customerOnboardingSpace,
  space,
  spaces,
};

export {
  spaceAgentAssignmentTypeResolvers,
  spaceChecklistTemplateTypeResolvers,
  spaceMemberTypeResolvers,
  spaceTypeResolvers,
} from "./types.js";
