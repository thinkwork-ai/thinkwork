import { threadTraces } from "./threadTraces.query.js";
import { agentPerformance } from "./agentPerformance.query.js";
import { performanceTimeSeries } from "./performanceTimeSeries.query.js";
import { singleAgentPerformance } from "./singleAgentPerformance.query.js";
import { agentCostBreakdown } from "./agentCostBreakdown.query.js";
import { turnInvocationLogs } from "./turnInvocationLogs.query.js";

export const observabilityQueries = { threadTraces, agentPerformance, performanceTimeSeries, singleAgentPerformance, agentCostBreakdown, turnInvocationLogs };
