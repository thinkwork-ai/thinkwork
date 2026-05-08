/**
 * Compliance reader DB module.
 *
 * Lazy `pg.Client` keyed off `COMPLIANCE_READER_SECRET_ARN`. Used by
 * the U10 GraphQL compliance resolvers (complianceEvents,
 * complianceEvent, complianceEventByHash) to read
 * `compliance.audit_events` under the least-privilege `compliance_reader`
 * Aurora role.
 *
 * Why a second pool, not `SET LOCAL ROLE` on the existing
 * `graphql_db_secret_arn` pool: role-switching inside the writer pool
 * requires every compliance query to wrap in a transaction with
 * `SET LOCAL ROLE compliance_reader; ... ; RESET ROLE`. A future query
 * that forgets the wrapper inherits writer privileges silently — too
 * easy to regress. The dedicated lazy module mirrors the
 * `compliance-anchor.ts` writer pattern, which is battle-tested.
 *
 * Why `sslmode=require`, not `sslmode=no-verify` (the writer pattern):
 * the read path is the higher-stakes surface for an audit tool —
 * tightening TLS posture is appropriate.
 *
 * Test escape hatch: `process.env.NODE_ENV === "test"` +
 * `COMPLIANCE_READER_DATABASE_URL` bypasses the Secrets Manager fetch
 * so resolver unit tests can point at a local pg or a mock client.
 */

import {
	GetSecretValueCommand,
	SecretsManagerClient,
} from "@aws-sdk/client-secrets-manager";
import type { Client as PgClientType } from "pg";

let _client: PgClientType | undefined;
let _secretsManager: SecretsManagerClient | undefined;

interface SecretShape {
	username: string;
	password: string;
	host: string;
	port: number | string;
	dbname: string;
}

function getSecretsManagerClient(): SecretsManagerClient {
	if (_secretsManager) return _secretsManager;
	_secretsManager = new SecretsManagerClient({
		region: process.env.AWS_REGION || "us-east-1",
		requestHandler: { requestTimeout: 5000, connectionTimeout: 3000 },
	});
	return _secretsManager;
}

async function resolveDatabaseUrl(): Promise<string> {
	const secretArn = process.env.COMPLIANCE_READER_SECRET_ARN;
	if (!secretArn) {
		throw new Error(
			"compliance/reader-db: COMPLIANCE_READER_SECRET_ARN is unset. " +
				"Compliance event browsing is not available in this environment. " +
				"Wire the env var on the graphql-http Lambda via Terraform.",
		);
	}
	const sm = getSecretsManagerClient();
	const result = await sm.send(
		new GetSecretValueCommand({ SecretId: secretArn }),
	);
	const secret = JSON.parse(result.SecretString || "{}") as SecretShape;
	const user = encodeURIComponent(secret.username);
	const pass = encodeURIComponent(secret.password);
	// sslmode=require — TLS encryption + server-cert validation. Mirrors
	// what AWS RDS recommends for cross-VPC hops; the writer Lambda's
	// no-verify default is acceptable for short-lived per-cadence anchor
	// writes inside the VPC, but the read surface is the load-bearing
	// audit-tool path and warrants the stricter mode.
	return `postgresql://${user}:${pass}@${secret.host}:${secret.port}/${secret.dbname}?sslmode=require`;
}

/**
 * Lazy pg client cache. Returns a connected `pg.Client`. On any
 * connection error, the cached client is invalidated so the next call
 * rebuilds it. Mirrors the writer's
 * `_readerDb` pattern in `packages/lambda/compliance-anchor.ts`.
 */
export async function getComplianceReaderClient(): Promise<PgClientType> {
	if (_client) return _client;

	if (
		process.env.NODE_ENV === "test" &&
		process.env.COMPLIANCE_READER_DATABASE_URL
	) {
		const { Client } = await import("pg");
		const client = new Client({
			connectionString: process.env.COMPLIANCE_READER_DATABASE_URL,
		});
		await client.connect();
		client.on("error", () => {
			_client = undefined;
		});
		_client = client;
		return client;
	}

	const url = await resolveDatabaseUrl();
	const { Client } = await import("pg");
	const client = new Client({ connectionString: url });
	await client.connect();
	client.on("error", () => {
		_client = undefined;
	});
	_client = client;
	return client;
}

/**
 * Test-only: clear the cached client so a fresh connection is built
 * on the next call. Used by integration tests + mocks.
 */
export function _resetComplianceReaderClient(): void {
	_client = undefined;
	_secretsManager = undefined;
}
