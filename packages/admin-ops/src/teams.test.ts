import { describe, it, expect, vi } from "vitest";
import { createClient } from "./client.js";
import {
	listTeams,
	getTeam,
	createTeam,
	addTeamAgent,
	removeTeamAgent,
} from "./teams.js";

function mockFetch(
	data: unknown,
	opts: { status?: number } = {},
): ReturnType<typeof vi.fn> {
	return vi.fn().mockResolvedValue(
		new Response(JSON.stringify({ data }), {
			status: opts.status ?? 200,
			headers: { "Content-Type": "application/json" },
		}),
	);
}

describe("teams", () => {
	const clientArgs = {
		apiUrl: "https://api.example.com",
		authSecret: "s3cret",
	};

	it("listTeams POSTs /graphql with { teams } query", async () => {
		const fetchImpl = mockFetch({ teams: [{ id: "t1", name: "Alpha" }] });
		const client = createClient({ ...clientArgs, fetchImpl });

		const out = await listTeams(client, "tenant-1");

		const [url, init] = fetchImpl.mock.calls[0]!;
		expect(url).toBe("https://api.example.com/graphql");
		expect(init!.method).toBe("POST");
		const body = JSON.parse(init!.body as string);
		expect(body.query).toContain("teams(tenantId:");
		expect(body.variables).toEqual({ tenantId: "tenant-1" });
		expect(out).toEqual([{ id: "t1", name: "Alpha" }]);
	});

	it("getTeam returns null when team not found", async () => {
		const fetchImpl = mockFetch({ team: null });
		const client = createClient({ ...clientArgs, fetchImpl });
		const out = await getTeam(client, "missing");
		expect(out).toBeNull();
	});

	it("createTeam sends CreateTeamInput and returns the team", async () => {
		const fetchImpl = mockFetch({ createTeam: { id: "t1", name: "Alpha", slug: "alpha" } });
		const client = createClient({ ...clientArgs, fetchImpl });

		const out = await createTeam(client, {
			tenantId: "tenant-1",
			name: "Alpha",
			description: "hi",
			budgetMonthlyCents: 1000,
		});

		const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
		expect(body.query).toContain("createTeam(input:");
		expect(body.variables.input).toEqual({
			tenantId: "tenant-1",
			name: "Alpha",
			description: "hi",
			budgetMonthlyCents: 1000,
		});
		expect(out).toEqual({ id: "t1", name: "Alpha", slug: "alpha" });
	});

	it("addTeamAgent carries teamId + input through the wire", async () => {
		const fetchImpl = mockFetch({ addTeamAgent: { id: "ta1", role: "lead" } });
		const client = createClient({ ...clientArgs, fetchImpl });
		await addTeamAgent(client, "team-1", { agentId: "agent-1", role: "lead" });
		const body = JSON.parse((fetchImpl.mock.calls[0]![1] as RequestInit).body as string);
		expect(body.variables).toEqual({ teamId: "team-1", input: { agentId: "agent-1", role: "lead" } });
	});

	it("removeTeamAgent coerces the boolean into { removed }", async () => {
		const fetchImpl = mockFetch({ removeTeamAgent: true });
		const client = createClient({ ...clientArgs, fetchImpl });
		const out = await removeTeamAgent(client, "team-1", "agent-1");
		expect(out).toEqual({ removed: true });
	});

	it("surfaces GraphQL errors as AdminOpsError", async () => {
		const fetchImpl = vi.fn().mockResolvedValue(
			new Response(
				JSON.stringify({ data: null, errors: [{ message: "FORBIDDEN" }] }),
				{ status: 200, headers: { "Content-Type": "application/json" } },
			),
		);
		const client = createClient({ ...clientArgs, fetchImpl });
		await expect(listTeams(client, "tenant-1")).rejects.toMatchObject({
			name: "AdminOpsError",
			message: "FORBIDDEN",
		});
	});
});
