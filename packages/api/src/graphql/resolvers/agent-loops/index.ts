import { agentLoop } from "./agentLoop.query.js";
import { agentLoopRun } from "./agentLoopRun.query.js";
import { agentLoops } from "./agentLoops.query.js";
import { deleteAgentLoop } from "./deleteAgentLoop.mutation.js";
import { saveAgentLoop } from "./saveAgentLoop.mutation.js";
import { triggerAgentLoopRun } from "./triggerAgentLoopRun.mutation.js";

export const agentLoopQueries = {
  agentLoop,
  agentLoopRun,
  agentLoops,
};

export const agentLoopMutations = {
  deleteAgentLoop,
  saveAgentLoop,
  triggerAgentLoopRun,
};

export {
  agentLoopIterationTypeResolvers,
  agentLoopJudgmentTypeResolvers,
  agentLoopRunTypeResolvers,
  agentLoopTypeResolvers,
  agentLoopVersionTypeResolvers,
} from "./types.js";
