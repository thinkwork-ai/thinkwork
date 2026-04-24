/**
 * Shared GraphQL field-selection strings.
 *
 * These originally mirrored
 * packages/skill-catalog/thinkwork-admin/scripts/operations/reads.py,
 * but the Python selections had drifted from the live GraphQL schema.
 * Any further drift surfaces as "Cannot query field X on type Y" at
 * runtime. When it does, the fix is to check
 * packages/database-pg/graphql/types/*.graphql and update the constant
 * here.
 */

export const AGENT_FIELDS =
	// The Agent type doesn't expose budgetMonthlyCents at the top
	// level — budget is a nested `budgetPolicy: AgentBudgetPolicy`
	// field. Not included here to keep selections minimal; callers
	// who need budget info can query it via a dedicated tool.
	"id name slug role type adapterType status humanPairId templateId parentAgentId createdAt";

export const TEMPLATE_FIELDS =
	"id name slug description category icon model isPublished createdAt";

export const TENANT_FIELDS = "id name slug plan issuePrefix issueCounter createdAt";

export const USER_FIELDS = "id tenantId email name image phone createdAt";

export const TENANT_MEMBER_FIELDS =
	"id tenantId principalType principalId role status createdAt";

export const TEAM_FIELDS =
	"id name slug description type status budgetMonthlyCents createdAt";

export const TEAM_AGENT_FIELDS = "id teamId agentId tenantId role joinedAt";

export const TEAM_USER_FIELDS = "id teamId userId tenantId role joinedAt";

export const SKILL_FIELDS =
	"agentId skillId config permissions rateLimitRpm modelOverride enabled";

export const CAPABILITY_FIELDS = "agentId capability config enabled";

export const ARTIFACT_FIELDS =
	// Artifact has `content: String` (the body) — the Python skill's
	// ARTIFACT_FIELDS was `contentRef`, which the schema doesn't expose.
	// Including summary + metadata + s3Key opportunistically since the
	// type does carry them and they're useful for agents working with
	// artifacts.
	"id tenantId threadId agentId type status title content summary s3Key metadata createdAt updatedAt";

export const SYNC_SUMMARY_FIELDS = "agentsSynced agentsFailed errors";
