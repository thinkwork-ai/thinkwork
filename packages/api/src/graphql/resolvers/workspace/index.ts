import { agentWorkspaceEvents_ as agentWorkspaceEvents } from "./agentWorkspaceEvents.query.js";
import { agentWorkspaceReview } from "./agentWorkspaceReview.query.js";
import { agentWorkspaceReviews } from "./agentWorkspaceReviews.query.js";
import { agentWorkspaceRuns_ as agentWorkspaceRuns } from "./agentWorkspaceRuns.query.js";
import { pendingSystemReviewsCount } from "./pendingSystemReviewsCount.query.js";
import {
  acceptAgentWorkspaceReview,
  cancelAgentWorkspaceReview,
  resumeAgentWorkspaceRun,
} from "./reviewDecision.mutation.js";

export const workspaceQueries = {
  agentWorkspaceEvents,
  agentWorkspaceReview,
  agentWorkspaceReviews,
  agentWorkspaceRuns,
  pendingSystemReviewsCount,
};

export const workspaceMutations = {
  acceptAgentWorkspaceReview,
  cancelAgentWorkspaceReview,
  resumeAgentWorkspaceRun,
};
