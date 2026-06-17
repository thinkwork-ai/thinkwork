import type {
  EmailReadinessCheckKey,
  EmailReadinessCheckResult,
} from "./provider-contract.js";

export const PRODUCTION_READINESS_CHECKS: EmailReadinessCheckKey[] = [
  "credentials",
  "sending_domain",
  "inbound_receiving",
  "webhook_signature",
];

export function buildReadinessChecks(input: {
  credentialConfigured: boolean;
  webhookSecretConfigured: boolean;
  domainVerified: boolean;
  inboundVerified: boolean;
  providerEventsReachable: boolean;
  loopTestPassed: boolean;
}): EmailReadinessCheckResult[] {
  return [
    readinessCheck("credentials", input.credentialConfigured, {
      failureCode: "missing_credentials",
      failureMessage: "Provider credentials are not configured.",
    }),
    readinessCheck("sending_domain", input.domainVerified, {
      failureCode: "sending_domain_unverified",
      failureMessage: "Sending domain is not verified.",
    }),
    readinessCheck("inbound_receiving", input.inboundVerified, {
      failureCode: "inbound_receiving_unverified",
      failureMessage: "Inbound receiving is not verified.",
    }),
    readinessCheck("webhook_signature", input.webhookSecretConfigured, {
      failureCode: "missing_webhook_secret",
      failureMessage: "Webhook signing secret is not configured.",
    }),
    evidenceCheck("provider_events", input.providerEventsReachable),
    evidenceCheck("loop_test", input.loopTestPassed),
  ];
}

export function productionReadinessPassed(
  checks: EmailReadinessCheckResult[],
): boolean {
  return PRODUCTION_READINESS_CHECKS.every((key) =>
    checks.some((check) => check.checkKey === key && check.status === "pass"),
  );
}

function readinessCheck(
  checkKey: EmailReadinessCheckKey,
  passed: boolean,
  failure: { failureCode: string; failureMessage: string },
): EmailReadinessCheckResult {
  return passed
    ? { checkKey, status: "pass", metadata: {} }
    : { checkKey, status: "blocked", ...failure, metadata: {} };
}

function evidenceCheck(
  checkKey: EmailReadinessCheckKey,
  passed: boolean,
): EmailReadinessCheckResult {
  return passed
    ? { checkKey, status: "pass", metadata: { requiredForProduction: false } }
    : {
        checkKey,
        status: "pending",
        metadata: { requiredForProduction: false },
      };
}
