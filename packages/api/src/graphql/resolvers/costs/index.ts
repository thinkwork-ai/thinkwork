import { costSummary } from "./costSummary.query.js";
import { costByAgent } from "./costByAgent.query.js";
import { costByUser } from "./costByUser.query.js";
import { costByModel } from "./costByModel.query.js";
import { costTimeSeries } from "./costTimeSeries.query.js";
import { accountUsage } from "./accountUsage.query.js";
import { budgetPolicies_ as budgetPolicies } from "./budgetPolicies.query.js";
import { budgetStatus } from "./budgetStatus.query.js";
import { agentBudgetStatus } from "./agentBudgetStatus.query.js";
import { userBudgetStatus } from "./userBudgetStatus.query.js";
import { upsertBudgetPolicy } from "./upsertBudgetPolicy.mutation.js";
import { deleteBudgetPolicy } from "./deleteBudgetPolicy.mutation.js";
import { unpauseAgent } from "./unpauseAgent.mutation.js";
import { unpauseUserBudget } from "./unpauseUserBudget.mutation.js";

export const costQueries = {
  costSummary,
  costByAgent,
  costByUser,
  costByModel,
  costTimeSeries,
  accountUsage,
  budgetPolicies,
  budgetStatus,
  agentBudgetStatus,
  userBudgetStatus,
};
export const costMutations = {
  upsertBudgetPolicy,
  deleteBudgetPolicy,
  unpauseAgent,
  unpauseUserBudget,
};
