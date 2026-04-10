export const queryKeys = {
  tenants: {
    all: ["tenants"] as const,
    detail: (id: string) => ["tenants", id] as const,
    settings: (tenantId: string) => ["tenants", tenantId, "settings"] as const,
    members: (tenantId: string) => ["tenants", tenantId, "members"] as const,
  },
  agents: {
    all: (tenantId: string) => ["agents", tenantId] as const,
    detail: (id: string) => ["agents", "detail", id] as const,
    capabilities: (agentId: string) => ["agents", agentId, "capabilities"] as const,
    skills: (agentId: string) => ["agents", agentId, "skills"] as const,
    budget: (agentId: string) => ["agents", agentId, "budget"] as const,
  },
  threads: {
    all: (tenantId: string) => ["threads", tenantId] as const,
    detail: (id: string) => ["threads", "detail", id] as const,
    comments: (threadId: string) => ["threads", threadId, "comments"] as const,
  },
  teams: {
    all: (tenantId: string) => ["teams", tenantId] as const,
    detail: (id: string) => ["teams", "detail", id] as const,
    agents: (teamId: string) => ["teams", teamId, "agents"] as const,
    users: (teamId: string) => ["teams", teamId, "users"] as const,
  },
  routines: {
    all: (tenantId: string) => ["routines", tenantId] as const,
    detail: (id: string) => ["routines", "detail", id] as const,
    runs: (routineId: string) => ["routines", routineId, "runs"] as const,
  },
  threadTurns: {
    all: (tenantId: string) => ["thread-turns", tenantId] as const,
    detail: (id: string) => ["thread-turns", "detail", id] as const,
    events: (runId: string) => ["thread-turns", runId, "events"] as const,
  },
  wakeupRequests: {
    all: (tenantId: string) => ["wakeup-requests", tenantId] as const,
  },
  inboxItems: {
    all: (tenantId: string) => ["inbox-items", tenantId] as const,
    detail: (id: string) => ["inbox-items", "detail", id] as const,
  },
  usage: {
    all: (tenantId: string) => ["usage", tenantId] as const,
    summary: (tenantId: string) => ["usage", tenantId, "summary"] as const,
  },
  activity: {
    all: (tenantId: string) => ["activity", tenantId] as const,
  },
  costs: {
    all: (tenantId: string) => ["costs", tenantId] as const,
    summary: (tenantId: string) => ["costs", tenantId, "summary"] as const,
    byAgent: (tenantId: string) => ["costs", tenantId, "by-agent"] as const,
    byModel: (tenantId: string) => ["costs", tenantId, "by-model"] as const,
    timeSeries: (tenantId: string) => ["costs", tenantId, "time-series"] as const,
    budgets: (tenantId: string) => ["costs", tenantId, "budgets"] as const,
  },
  skills: {
    all: ["skills"] as const,
    detail: (id: string) => ["skills", "detail", id] as const,
  },
};
