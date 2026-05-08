/**
 * Contract tests for the compliance read-resolver auth boundary.
 *
 * Three axes the resolvers MUST enforce, asserted here against the
 * shared `requireComplianceReader` helper used by all three queries:
 *
 *   1. apikey hard-block — Strands runtime + service-secret callers
 *      get FORBIDDEN before any SQL fires. Mirrors
 *      `requireNotFromAdminSkill` in
 *      `packages/api/src/graphql/resolvers/core/authz.ts`.
 *
 *   2. operator-vs-tenant scope via THINKWORK_PLATFORM_OPERATOR_EMAILS —
 *      operators can pass any `args.filter.tenantId`; non-operators
 *      have it server-side-overridden to their own tenant scope before
 *      SQL parameterization (no TOCTOU between zod validation + auth).
 *
 *   3. null-tenant fail-closed — a non-operator caller whose
 *      resolveCallerTenantId returns null (Google-OAuth user with no
 *      DB row yet) gets UNAUTHENTICATED rather than fall through with
 *      a null tenant filter (which would either return zero rows OR
 *      leak cross-tenant if the SQL composer omits the WHERE clause).
 */

import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { GraphQLError } from "graphql";
import { requireComplianceReader } from "../lib/compliance/resolver-auth.js";

vi.mock("../graphql/resolvers/core/resolve-auth-user.js", () => ({
	resolveCallerTenantId: vi.fn(),
}));

import { resolveCallerTenantId } from "../graphql/resolvers/core/resolve-auth-user.js";

const TENANT_A = "11111111-1111-7111-8111-aaaaaaaaaaaa";
const TENANT_B = "22222222-2222-7222-8222-bbbbbbbbbbbb";
const OPERATOR_EMAIL = "operator@thinkwork.example";
const TENANT_USER_EMAIL = "alice@acme.example";

const ORIGINAL_ENV = { ...process.env };

beforeEach(() => {
	process.env = { ...ORIGINAL_ENV };
	process.env.COMPLIANCE_READER_SECRET_ARN =
		"arn:aws:secretsmanager:us-east-1:123:secret:thinkwork/dev/compliance/reader-credentials";
	process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS = OPERATOR_EMAIL;
	(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockReset();
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

describe("requireComplianceReader — axis 1: apikey hard-block", () => {
	it("apikey caller is REJECTED with FORBIDDEN before any SQL would fire", async () => {
		await expect(
			requireComplianceReader(ctxApikey() as never, undefined),
		).rejects.toMatchObject({
			extensions: { code: "FORBIDDEN" },
		});
	});

	it("apikey caller cannot bypass via filter.tenantId scoped to their own tenant", async () => {
		// Even with a 'plausible' tenant filter, apikey is still blocked.
		await expect(
			requireComplianceReader(ctxApikey() as never, TENANT_A),
		).rejects.toBeInstanceOf(GraphQLError);
	});
});

describe("requireComplianceReader — axis 2: operator-vs-tenant scope", () => {
	it("operator caller may pass any tenantId — accepted as-is", async () => {
		const scope = await requireComplianceReader(
			ctxCognito({ email: OPERATOR_EMAIL, tenantId: TENANT_A }) as never,
			TENANT_B, // operator browsing a different tenant's events
		);
		expect(scope.isOperator).toBe(true);
		expect(scope.effectiveTenantId).toBe(TENANT_B);
		// resolveCallerTenantId NOT called — operators skip the override.
		expect(resolveCallerTenantId).not.toHaveBeenCalled();
	});

	it("operator caller with no filter.tenantId → effectiveTenantId is undefined (all-tenants)", async () => {
		const scope = await requireComplianceReader(
			ctxCognito({ email: OPERATOR_EMAIL, tenantId: TENANT_A }) as never,
			undefined,
		);
		expect(scope.isOperator).toBe(true);
		expect(scope.effectiveTenantId).toBeUndefined();
	});

	it("non-operator passing filter.tenantId = OTHER_TENANT — server-side overridden to caller's resolved tenant", async () => {
		(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			TENANT_A,
		);
		const scope = await requireComplianceReader(
			ctxCognito({ email: TENANT_USER_EMAIL, tenantId: TENANT_A }) as never,
			TENANT_B, // non-operator trying to spoof another tenant
		);
		expect(scope.isOperator).toBe(false);
		// CRITICAL: filter.tenantId is overridden, NOT preserved as TENANT_B.
		expect(scope.effectiveTenantId).toBe(TENANT_A);
	});

	it("non-operator with no filter.tenantId — effectiveTenantId is the caller's own resolved tenant", async () => {
		(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			TENANT_A,
		);
		const scope = await requireComplianceReader(
			ctxCognito({ email: TENANT_USER_EMAIL, tenantId: TENANT_A }) as never,
			undefined,
		);
		expect(scope.effectiveTenantId).toBe(TENANT_A);
	});

	it("operator email check is case-insensitive", async () => {
		const scope = await requireComplianceReader(
			ctxCognito({ email: OPERATOR_EMAIL.toUpperCase() }) as never,
			TENANT_B,
		);
		expect(scope.isOperator).toBe(true);
	});
});

describe("requireComplianceReader — axis 3: null-tenant fail-closed", () => {
	it("non-operator Google-OAuth user with null ctx.auth.tenantId AND null resolved tenant → UNAUTHENTICATED", async () => {
		(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			null,
		);
		await expect(
			requireComplianceReader(
				ctxCognito({ email: TENANT_USER_EMAIL, tenantId: null }) as never,
				undefined,
			),
		).rejects.toMatchObject({
			extensions: { code: "UNAUTHENTICATED" },
		});
	});

	it("non-operator with null email → not in operator allowlist → falls through to tenant resolution", async () => {
		(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			null,
		);
		await expect(
			requireComplianceReader(
				ctxCognito({ email: null, tenantId: null }) as never,
				undefined,
			),
		).rejects.toMatchObject({
			extensions: { code: "UNAUTHENTICATED" },
		});
	});
});

describe("requireComplianceReader — env-var precondition", () => {
	it("missing COMPLIANCE_READER_SECRET_ARN throws INTERNAL_SERVER_ERROR with the env-var name", async () => {
		delete process.env.COMPLIANCE_READER_SECRET_ARN;
		await expect(
			requireComplianceReader(
				ctxCognito({ email: OPERATOR_EMAIL }) as never,
				undefined,
			),
		).rejects.toMatchObject({
			extensions: { code: "INTERNAL_SERVER_ERROR" },
		});
		try {
			await requireComplianceReader(
				ctxCognito({ email: OPERATOR_EMAIL }) as never,
				undefined,
			);
		} catch (err) {
			expect((err as Error).message).toMatch(
				/COMPLIANCE_READER_SECRET_ARN/,
			);
		}
	});

	it("empty THINKWORK_PLATFORM_OPERATOR_EMAILS allowlist → user is non-operator (forced to own tenant)", async () => {
		process.env.THINKWORK_PLATFORM_OPERATOR_EMAILS = "";
		(resolveCallerTenantId as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce(
			TENANT_A,
		);
		const scope = await requireComplianceReader(
			ctxCognito({ email: OPERATOR_EMAIL, tenantId: TENANT_A }) as never,
			TENANT_B,
		);
		expect(scope.isOperator).toBe(false);
		expect(scope.effectiveTenantId).toBe(TENANT_A);
	});
});
