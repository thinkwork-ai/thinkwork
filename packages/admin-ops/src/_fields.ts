/**
 * Shared GraphQL field-selection strings. Match the constants in
 * packages/skill-catalog/thinkwork-admin/scripts/operations/reads.py
 * so the MCP surface returns the same shapes the Python skill did.
 */

export const AGENT_FIELDS =
	"id name slug role type adapterType status budgetMonthlyCents humanPairId templateId parentAgentId createdAt";

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
	"id tenantId threadId agentId type status title contentRef createdAt updatedAt";

export const SYNC_SUMMARY_FIELDS = "agentsSynced agentsFailed errors";
