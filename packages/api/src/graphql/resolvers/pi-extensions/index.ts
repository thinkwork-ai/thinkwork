import { importPiExtensionFromGitHub } from "./importPiExtensionFromGitHub.mutation.js";
import { piExtensions } from "./piExtensions.query.js";

export const piExtensionQueries = {
  piExtensions,
};

export const piExtensionMutations = {
  importPiExtensionFromGitHub,
};
