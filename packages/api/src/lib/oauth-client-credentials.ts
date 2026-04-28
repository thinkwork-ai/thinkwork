/**
 * Fetch OAuth client credentials from AWS Secrets Manager with a
 * module-level cache.
 *
 * Cold-start: the first call per provider makes one GetSecretValue
 * request. Subsequent calls in the same warm container hit the cache.
 *
 * The secret value is JSON-encoded `{"client_id":"...","client_secret":"..."}`.
 * Secret ARNs are held in these env vars (set via common_env in
 * `terraform/modules/app/lambda-api/handlers.tf`):
 *
 *   GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN
 *   MICROSOFT_OAUTH_SECRET_ARN
 *
 * Consumers: oauth-authorize, oauth-callback, oauth-token refresh path.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export type OAuthProviderName = "google_productivity" | "microsoft_365";

export interface OAuthClientCredentials {
	clientId: string;
	clientSecret: string;
}

const cache = new Map<OAuthProviderName, OAuthClientCredentials>();

const SECRET_ARN_ENV: Record<OAuthProviderName, string> = {
	google_productivity: "GOOGLE_PRODUCTIVITY_OAUTH_SECRET_ARN",
	microsoft_365:       "MICROSOFT_OAUTH_SECRET_ARN",
};

let smClient: SecretsManagerClient | null = null;
function getClient(): SecretsManagerClient {
	if (!smClient) {
		smClient = new SecretsManagerClient({
			region: process.env.AWS_REGION || "us-east-1",
		});
	}
	return smClient;
}

export async function getOAuthClientCredentials(
	providerName: OAuthProviderName,
): Promise<OAuthClientCredentials> {
	const cached = cache.get(providerName);
	if (cached) return cached;

	const envVar = SECRET_ARN_ENV[providerName];
	const secretArn = process.env[envVar] || "";
	if (!secretArn) {
		throw new Error(
			`${envVar} not set — the Lambda environment is missing the OAuth secret ARN. Check terraform/modules/app/lambda-api/handlers.tf common_env.`,
		);
	}

	const res = await getClient().send(
		new GetSecretValueCommand({ SecretId: secretArn }),
	);
	if (!res.SecretString) {
		throw new Error(
			`Secrets Manager returned empty SecretString for ${secretArn} — check the secret value exists and is populated.`,
		);
	}

	let parsed: { client_id?: string; client_secret?: string };
	try {
		parsed = JSON.parse(res.SecretString);
	} catch (err) {
		throw new Error(
			`Secrets Manager value for ${secretArn} is not valid JSON. Expected {"client_id":"...","client_secret":"..."}.`,
		);
	}

	const clientId = parsed.client_id || "";
	const clientSecret = parsed.client_secret || "";
	if (!clientId || !clientSecret) {
		throw new Error(
			`OAuth credentials for ${providerName} are incomplete. Secret ${secretArn} must contain both client_id and client_secret.`,
		);
	}

	const creds: OAuthClientCredentials = { clientId, clientSecret };
	cache.set(providerName, creds);
	console.log(
		`[oauth-client-credentials] Loaded ${providerName} from Secrets Manager`,
	);
	return creds;
}

export function isSecretsManagerProvider(
	providerName: string,
): providerName is OAuthProviderName {
	return providerName === "google_productivity" || providerName === "microsoft_365";
}
