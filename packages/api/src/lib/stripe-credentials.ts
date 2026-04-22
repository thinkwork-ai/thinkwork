/**
 * Fetch Stripe API credentials from AWS Secrets Manager with a module-level
 * cache.
 *
 * Cold-start: the first call per warm container makes one GetSecretValue
 * request. Subsequent calls hit the cache.
 *
 * Secret shape (JSON blob at STRIPE_CREDENTIALS_SECRET_ARN):
 *
 *   { "secret_key": "...", "publishable_key": "...", "webhook_signing_secret": "..." }
 *
 * Operators populate the value out-of-band (never via tfvars):
 *
 *   aws secretsmanager put-secret-value \
 *     --secret-id thinkwork/<stage>/stripe/api-credentials \
 *     --secret-string file://stripe-creds.json
 *
 * Mirrors the Google/Microsoft OAuth credentials pattern in
 * oauth-client-credentials.ts so operator habits (Console rotation,
 * lifecycle.ignore_changes) port cleanly.
 */

import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";

export interface StripeCredentials {
	secretKey: string;
	publishableKey: string;
	webhookSigningSecret: string;
}

let cached: StripeCredentials | null = null;

let smClient: SecretsManagerClient | null = null;
function getClient(): SecretsManagerClient {
	if (!smClient) {
		smClient = new SecretsManagerClient({
			region: process.env.AWS_REGION || "us-east-1",
		});
	}
	return smClient;
}

export async function getStripeCredentials(): Promise<StripeCredentials> {
	if (cached) return cached;

	const secretArn = process.env.STRIPE_CREDENTIALS_SECRET_ARN || "";
	if (!secretArn) {
		throw new Error(
			"STRIPE_CREDENTIALS_SECRET_ARN not set — the Lambda environment is missing the Stripe secret ARN. Check terraform/modules/app/lambda-api/handlers.tf common_env.",
		);
	}

	const res = await getClient().send(
		new GetSecretValueCommand({ SecretId: secretArn }),
	);
	if (!res.SecretString) {
		throw new Error(
			`Secrets Manager returned empty SecretString for ${secretArn} — populate it via \`aws secretsmanager put-secret-value\`.`,
		);
	}

	let parsed: {
		secret_key?: string;
		publishable_key?: string;
		webhook_signing_secret?: string;
	};
	try {
		parsed = JSON.parse(res.SecretString);
	} catch {
		throw new Error(
			`Secrets Manager value for ${secretArn} is not valid JSON. Expected {"secret_key":"...","publishable_key":"...","webhook_signing_secret":"..."}.`,
		);
	}

	const secretKey = parsed.secret_key || "";
	const publishableKey = parsed.publishable_key || "";
	const webhookSigningSecret = parsed.webhook_signing_secret || "";
	if (!secretKey || !publishableKey || !webhookSigningSecret) {
		throw new Error(
			`Stripe credentials incomplete at ${secretArn}. Secret must contain non-empty secret_key, publishable_key, and webhook_signing_secret.`,
		);
	}

	const creds: StripeCredentials = {
		secretKey,
		publishableKey,
		webhookSigningSecret,
	};
	cached = creds;
	// Never log secret values. Logging the ARN alone is safe.
	console.log(`[stripe-credentials] Loaded from ${secretArn}`);
	return creds;
}

/** Test-only helper to clear the module cache between tests. */
export function __resetStripeCredentialsCacheForTest(): void {
	cached = null;
}
