import { capabilityInspector } from "./capabilityInspector.query.js";
import {
  workspacePreview,
  workspacePreviewFile,
} from "./workspacePreview.query.js";
import {
  grantCapability,
  detachCapability,
} from "./capabilityAssignment.mutations.js";

export const capabilityQueries = {
  capabilityInspector,
  workspacePreview,
  workspacePreviewFile,
};

export const capabilityMutations = {
  grantCapability,
  detachCapability,
};
