import { addSpaceMember } from "./addSpaceMember.mutation.js";
import { customerOnboardingSpace } from "./customerOnboardingSpace.query.js";
import { createSpace } from "./createSpace.mutation.js";
import { deleteSpace } from "./deleteSpace.mutation.js";
import { removeSpaceMember } from "./removeSpaceMember.mutation.js";
import {
  setSpaceEmailTriggers,
  updateSpaceEmailTrigger,
} from "./setSpaceEmailTriggers.mutation.js";
import { setSpaceKnowledgeBases } from "./setSpaceKnowledgeBases.mutation.js";
import { setSpaceRuntimeOverrides } from "./setSpaceRuntimeOverrides.mutation.js";
import { setSpaceTools } from "./setSpaceTools.mutation.js";
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
  addSpaceMember,
  createSpace,
  deleteSpace,
  removeSpaceMember,
  setSpaceEmailTriggers,
  setSpaceKnowledgeBases,
  setSpaceRuntimeOverrides,
  setSpaceTools,
  startCustomerOnboarding,
  updateSpace,
  updateSpaceEmailTrigger,
};

export {
  spaceChecklistTemplateTypeResolvers,
  spaceMemberTypeResolvers,
  spaceMcpServerTypeResolvers,
  spaceTypeResolvers,
} from "./types.js";
