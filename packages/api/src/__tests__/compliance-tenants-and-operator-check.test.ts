/**
 * Contract tests for the U10 frontend backend pivots:
 *   - complianceTenants — tenant typeahead source
 *   - complianceOperatorCheck — top-level operator-status query
 *   - complianceEventByHash format guard
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
	complianceEventByHash,
	complianceOperatorCheck,
	complianceTenants,
} from "../graphql/resolvers/compliance/query.js";

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerTenantId: vi.fn(),
}));

vi.mock("../lib/compliance/reader-db.js", () => ({
	getComplianceReaderClient: vi.fn(),
}));

import { resolveCallerTenantId } from "../graphql/resolvers/core/resolve-auth-user.js";
import { getComplianceReaderClient } from "../lib/compliance/reader-db.js";

const TENANT_A = "11111111-1111-7111-8111-aaaaaaaaaaaa";
const TENANT_B = "22222222-2222-7222-8222-bbbbbbbbbbbb";
const TENANT_C = "33333333-3333-7333-8333-cccccccccccc";
const OPERATOR_EMAIL = "operator@thinkwork.example";
const TENANT_USER_EMAIL = "alice@acme.example";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	process.env = { ...ORIGINAL_ENV };
	process.env.COMPLIANCE_READER_SECRET_ARN =
		"arn:aws:secretsmanager:us-east-1:123:secret:thinkwork/dev/compliance/reader-credentials";
	process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
	(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockReset();
	(
		getComplianceReaderClient as unknown as ReturnType<typeof vi.fn>
	).mockReset();
});

afterEach(() => {
	process.env = { ...ORIGINAL_ENV };
});

function ctxCognito(opts: {
	email?: string | null;
	tenantId?: string | null;
}): unknown {
	return {
		auth: {
			authType: "cognito",
			principalId: "user-1",
			tenantId: opts.tenantId ?? null,
			email: opts.email ?? null,
			agentId: null,
		},
	};
}

function ctxApikey(): unknown {
	return {
		auth: {
			authType: "apikey",
			principalId: "system",
			tenantId: null,
			email: null,
			agentId: null,
		},
	};
}

// ---------------------------------------------------------------------------
// complianceTenants
// ---------------------------------------------------------------------------

describe("complianceTenants", () => {
	it("operator caller — returns full DISTINCT tenant_id list from the DB", async () => {
		const send = vi.fn(async () => ({
			rows: [
				{ tenant_id: TENANT_A },
				{ tenant_id: TENANT_B },
				{ tenant_id: TENANT_C },
			],
		}));
		(
			getComplianceReaderClient as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValue({ query: send });

		const result = await complianceTenants(
			null,
			{},
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);

		expect(result).toEqual([TENANT_A, TENANT_B, TENANT_C]);
		expect(send).toHaveBeenCalledTimes(1);
	});

	it("non-operator caller — returns 1-element list of own tenant WITHOUT hitting the DB", async () => {
		(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			TENANT_A,
		);
		const send = vi.fn();
		(
			getComplianceReaderClient as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValue({ query: send });

		const result = await complianceTenants(
			null,
			{},
			ctxCognito({ email: TENANT_USER_EMAIL }) as never,
		);

		expect(result).toEqual([TENANT_A]);
		expect(send).not.toHaveBeenCalled();
	});

	it("apikey caller — FORBIDDEN before any DB access", async () => {
		await expect(
			complianceTenants(null, {}, ctxApikey() as never),
		).rejects.toMatchObject({ extensions: { code: "FORBIDDEN" } });
	});
});

// ---------------------------------------------------------------------------
// complianceOperatorCheck
// ---------------------------------------------------------------------------

describe("complianceOperatorCheck", () => {
	it("operator email + configured allowlist → isOperator: true", async () => {
		const result = await complianceOperatorCheck(
			null,
			{},
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(result).toEqual({ isOperator: true, allowlistConfigured: true });
	});

	it("non-operator email + configured allowlist → isOperator: false, allowlistConfigured: true", async () => {
		const result = await complianceOperatorCheck(
			null,
			{},
			ctxCognito({ email: TENANT_USER_EMAIL }) as never,
		);
		expect(result).toEqual({ isOperator: false, allowlistConfigured: true });
	});

	it("empty allowlist (dev-env misconfig) → both false (distinct from authentic non-operator)", async () => {
		process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS = "";
		const result = await complianceOperatorCheck(
			null,
			{},
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(result).toEqual({ isOperator: false, allowlistConfigured: false });
	});

	it("apikey caller → both false (no operator status for service callers)", async () => {
		const result = await complianceOperatorCheck(
			null,
			{},
			ctxApikey() as never,
		);
		expect(result).toEqual({ isOperator: false, allowlistConfigured: false });
	});

	it("operator-email check is case-insensitive", async () => {
		const result = await complianceOperatorCheck(
			null,
			{},
			ctxCognito({ email: OPERATOR_EMAIL.toUpperCase() }) as never,
		);
		expect(result.isOperator).toBe(true);
	});
});

// ---------------------------------------------------------------------------
// complianceEventByHash format guard (SEC-004)
// ---------------------------------------------------------------------------

describe("complianceEventByHash format guard", () => {
	it("returns null without DB hit when eventHash is not 64 hex chars", async () => {
		const send = vi.fn();
		(
			getComplianceReaderClient as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValue({ query: send });

		// Too short
		const r1 = await complianceEventByHash(
			null,
			{ eventHash: "abc" },
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(r1).toBeNull();

		// Too long
		const r2 = await complianceEventByHash(
			null,
			{ eventHash: "a".repeat(128) },
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(r2).toBeNull();

		// Non-hex chars
		const r3 = await complianceEventByHash(
			null,
			{ eventHash: "z".repeat(64) },
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(r3).toBeNull();

		// Empty
		const r4 = await complianceEventByHash(
			null,
			{ eventHash: "" },
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(r4).toBeNull();

		// None of these should have hit the DB.
		expect(send).not.toHaveBeenCalled();
	});

	it("accepts 64 hex chars (lower or mixed case) and queries the DB", async () => {
		const send = vi.fn(async (_sql: string, _values: unknown[]) => ({
			rows: [],
		}));
		(
			getComplianceReaderClient as unknown as ReturnType<typeof vi.fn>
		).mockResolvedValue({ query: send });

		await complianceEventByHash(
			null,
			{ eventHash: "AB".repeat(32) }, // mixed case → normalized to lower
			ctxCognito({ email: OPERATOR_EMAIL }) as never,
		);
		expect(send).toHaveBeenCalledTimes(1);
		// Confirms toLowerCase() normalization on the parameter.
		expect(send.mock.calls[0][1][0]).toBe("ab".repeat(32));
	});
});
