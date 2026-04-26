import { activationSession } from "./activationSession.query.js";
import { activationSessionTurns_ as activationSessionTurns } from "./activationSessionTurns.query.js";
import { applyActivationBundle } from "./applyActivationBundle.mutation.js";
import { checkpointActivationLayer } from "./checkpointActivationLayer.mutation.js";
import { dismissActivationRecommendation } from "./dismissActivationRecommendation.mutation.js";
import { notifyActivationSessionUpdate } from "./notifyActivationSessionUpdate.mutation.js";
import { startActivation } from "./startActivation.mutation.js";
import { submitActivationTurn } from "./submitActivationTurn.mutation.js";

export const activationQueries = {
  activationSession,
  activationSessionTurns,
};

export const activationMutations = {
  startActivation,
  submitActivationTurn,
  checkpointActivationLayer,
  applyActivationBundle,
  dismissActivationRecommendation,
  notifyActivationSessionUpdate,
};
