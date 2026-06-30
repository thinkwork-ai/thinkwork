import { approvePiExtensionVersion } from "./approvePiExtensionVersion.mutation.js";
import { importPiExtensionFromGitHub } from "./importPiExtensionFromGitHub.mutation.js";
import { piExtensions } from "./piExtensions.query.js";
import { rejectPiExtensionVersion } from "./rejectPiExtensionVersion.mutation.js";
import { updatePiExtensionAssignment } from "./updatePiExtensionAssignment.mutation.js";

export const piExtensionQueries = {
  piExtensions,
};

export const piExtensionMutations = {
  approvePiExtensionVersion,
  importPiExtensionFromGitHub,
  rejectPiExtensionVersion,
  updatePiExtensionAssignment,
};
