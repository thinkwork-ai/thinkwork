/**
 * Team operations — mirrors
 * packages/skill-catalog/thinkwork-admin/scripts/operations/teams.py.
 * Mutations go through GraphQL (the REST /api/teams handler covers the
 * SPA path but doesn't expose every mutation; parity with the Python
 * skill is easiest via GraphQL).
 */

import type { AdminOpsClient } from "./client.js";
import {
	TEAM_FIELDS,
	TEAM_AGENT_FIELDS,
	TEAM_USER_FIELDS,
} from "./_fields.js";

export interface Team {
	id: string;
	name: string;
	slug: string;
	description: string | null;
	type: string | null;
	status: string;
	budgetMonthlyCents: number | null;
	createdAt: string;
}

export interface TeamAgent {
	id: string;
	teamId: string;
	agentId: string;
	tenantId: string;
	role: string;
	joinedAt: string;
}

export interface TeamUser {
	id: string;
	teamId: string;
	userId: string;
	tenantId: string;
	role: string;
	joinedAt: string;
}

// ---------------------------------------------------------------------------
// Reads
// ---------------------------------------------------------------------------

export async function listTeams(
	client: AdminOpsClient,
	tenantId: string,
): Promise<Team[]> {
	const data = await client.graphql<{ teams: Team[] }>(
		`query($tenantId: ID!) { teams(tenantId: $tenantId) { ${TEAM_FIELDS} } }`,
		{ tenantId },
	);
	return data.teams ?? [];
}

export async function getTeam(client: AdminOpsClient, id: string): Promise<Team | null> {
	const data = await client.graphql<{ team: Team | null }>(
		`query($id: ID!) { team(id: $id) { ${TEAM_FIELDS} } }`,
		{ id },
	);
	return data.team;
}

// ---------------------------------------------------------------------------
// Mutations
// ---------------------------------------------------------------------------

export interface CreateTeamInput {
	tenantId: string;
	name: string;
	description?: string;
	type?: string;
	budgetMonthlyCents?: number;
	idempotencyKey?: string;
}

export async function createTeam(
	client: AdminOpsClient,
	input: CreateTeamInput,
): Promise<Team> {
	const data = await client.graphql<{ createTeam: Team }>(
		`mutation($input: CreateTeamInput!) { createTeam(input: $input) { ${TEAM_FIELDS} } }`,
		{ input },
	);
	return data.createTeam;
}

export interface AddTeamAgentInput {
	agentId: string;
	role?: string;
	idempotencyKey?: string;
}

export async function addTeamAgent(
	client: AdminOpsClient,
	teamId: string,
	input: AddTeamAgentInput,
): Promise<TeamAgent> {
	const data = await client.graphql<{ addTeamAgent: TeamAgent }>(
		`mutation($teamId: ID!, $input: AddTeamAgentInput!) {
			addTeamAgent(teamId: $teamId, input: $input) { ${TEAM_AGENT_FIELDS} }
		}`,
		{ teamId, input },
	);
	return data.addTeamAgent;
}

export interface AddTeamUserInput {
	userId: string;
	role?: string;
	idempotencyKey?: string;
}

export async function addTeamUser(
	client: AdminOpsClient,
	teamId: string,
	input: AddTeamUserInput,
): Promise<TeamUser> {
	const data = await client.graphql<{ addTeamUser: TeamUser }>(
		`mutation($teamId: ID!, $input: AddTeamUserInput!) {
			addTeamUser(teamId: $teamId, input: $input) { ${TEAM_USER_FIELDS} }
		}`,
		{ teamId, input },
	);
	return data.addTeamUser;
}

export async function removeTeamAgent(
	client: AdminOpsClient,
	teamId: string,
	agentId: string,
): Promise<{ removed: boolean }> {
	const data = await client.graphql<{ removeTeamAgent: boolean }>(
		`mutation($teamId: ID!, $agentId: ID!) { removeTeamAgent(teamId: $teamId, agentId: $agentId) }`,
		{ teamId, agentId },
	);
	return { removed: Boolean(data.removeTeamAgent) };
}

export async function removeTeamUser(
	client: AdminOpsClient,
	teamId: string,
	userId: string,
): Promise<{ removed: boolean }> {
	const data = await client.graphql<{ removeTeamUser: boolean }>(
		`mutation($teamId: ID!, $userId: ID!) { removeTeamUser(teamId: $teamId, userId: $userId) }`,
		{ teamId, userId },
	);
	return { removed: Boolean(data.removeTeamUser) };
}
