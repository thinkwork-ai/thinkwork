import { capabilityInspector } from "./capabilityInspector.query.js";
import {
  grantCapability,
  detachCapability,
} from "./capabilityAssignment.mutations.js";

export const capabilityQueries = {
  capabilityInspector,
};

export const capabilityMutations = {
  grantCapability,
  detachCapability,
};
