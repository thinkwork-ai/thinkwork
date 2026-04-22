import { describe, it, expect, beforeEach } from "vitest";
import { mockClient } from "aws-sdk-client-mock";
import {
	SecretsManagerClient,
	GetSecretValueCommand,
} from "@aws-sdk/client-secrets-manager";
import {
	getStripeCredentials,
	__resetStripeCredentialsCacheForTest,
} from "./stripe-credentials";

const sm = mockClient(SecretsManagerClient);

describe("stripe-credentials", () => {
	beforeEach(() => {
		sm.reset();
		__resetStripeCredentialsCacheForTest();
		delete process.env.STRIPE_CREDENTIALS_SECRET_ARN;
	});

	it("loads + caches credentials from Secrets Manager", async () => {
		process.env.STRIPE_CREDENTIALS_SECRET_ARN =
			"arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/stripe/api-credentials-abc";
		sm.on(GetSecretValueCommand).resolves({
			SecretString: JSON.stringify({
				secret_key: "sk_test_abc",
				publishable_key: "pk_test_def",
				webhook_signing_secret: "whsec_xyz",
			}),
		});

		const a = await getStripeCredentials();
		expect(a).toEqual({
			secretKey: "sk_test_abc",
			publishableKey: "pk_test_def",
			webhookSigningSecret: "whsec_xyz",
		});

		// Second call must hit the cache — no second AWS call.
		const b = await getStripeCredentials();
		expect(b).toBe(a);
		expect(sm.commandCalls(GetSecretValueCommand).length).toBe(1);
	});

	it("throws a clear error when the ARN env var is missing", async () => {
		await expect(getStripeCredentials()).rejects.toThrow(
			/STRIPE_CREDENTIALS_SECRET_ARN/,
		);
	});

	it("throws when Secrets Manager returns an empty SecretString", async () => {
		process.env.STRIPE_CREDENTIALS_SECRET_ARN =
			"arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/stripe/api-credentials-abc";
		sm.on(GetSecretValueCommand).resolves({ SecretString: "" });
		await expect(getStripeCredentials()).rejects.toThrow(/empty SecretString/);
	});

	it("throws when stored JSON is malformed", async () => {
		process.env.STRIPE_CREDENTIALS_SECRET_ARN =
			"arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/stripe/api-credentials-abc";
		sm.on(GetSecretValueCommand).resolves({ SecretString: "{not json" });
		await expect(getStripeCredentials()).rejects.toThrow(/not valid JSON/);
	});

	it("throws when a required field is missing", async () => {
		process.env.STRIPE_CREDENTIALS_SECRET_ARN =
			"arn:aws:secretsmanager:us-east-1:1:secret:thinkwork/dev/stripe/api-credentials-abc";
		sm.on(GetSecretValueCommand).resolves({
			SecretString: JSON.stringify({
				secret_key: "sk_test",
				publishable_key: "",
				webhook_signing_secret: "whsec_x",
			}),
		});
		await expect(getStripeCredentials()).rejects.toThrow(/incomplete/);
	});
});
