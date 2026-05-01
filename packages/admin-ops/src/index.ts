export {
	createClient,
	AdminOpsError,
	type AdminOpsClient,
	type AdminOpsClientConfig,
} from "./client.js";

export * as tenants from "./tenants.js";
export type { Tenant, TenantSummary, UpdateTenantInput } from "./tenants.js";

export * as adminKeys from "./admin-keys.js";
export type {
	AdminKeyCreateInput,
	AdminKeyCreateResponse,
	AdminKeySummary,
} from "./admin-keys.js";

export * as teams from "./teams.js";
export type {
	Team,
	TeamAgent,
	TeamUser,
	CreateTeamInput,
	AddTeamAgentInput,
	AddTeamUserInput,
} from "./teams.js";

export * as agents from "./agents.js";
export type {
	Agent,
	AgentSkill,
	AgentCapability,
	ListAgentsInput,
	ListAllTenantAgentsInput,
	CreateAgentInput,
	AgentSkillInput,
	AgentCapabilityInput,
} from "./agents.js";

export * as templates from "./templates.js";
export type {
	AgentTemplate,
	SyncSummary,
	CreateAgentTemplateInput,
	CreateAgentFromTemplateInput,
} from "./templates.js";

export * as users from "./users.js";
export type { User, TenantMember } from "./users.js";

export * as artifacts from "./artifacts.js";
export type { Artifact, ListArtifactsInput } from "./artifacts.js";

export * as routines from "./routines.js";
export type {
	Routine,
	RoutineExecutionLite,
	CreateAgentRoutineInput,
	TriggerRoutineRunInput,
	VisibilityCheckResult,
} from "./routines.js";
