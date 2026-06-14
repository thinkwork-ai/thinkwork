import type { ReleaseUpdateJobRow } from "./release-preflight.js";

const CONTROLLER_CONTRACT = "thinkwork.deployment.controller.v1";
const CONTROLLER_SCHEMA_VERSION = 1;

export interface BuildReleaseUpdatePayloadArgs {
  tenantId: string;
  job: ReleaseUpdateJobRow;
  evidenceBucket: string | null;
  evidencePrefix: string;
}

export function buildReleaseUpdateControllerPayload({
  tenantId,
  job,
  evidenceBucket,
  evidencePrefix,
}: BuildReleaseUpdatePayloadArgs): Record<string, unknown> {
  const stage = process.env.STAGE || process.env.THINKWORK_STAGE || "unknown";
  const region = process.env.AWS_REGION || "us-east-1";
  const accountId = process.env.AWS_ACCOUNT_ID || "";
  const release = releaseSelection(job);
  const preservedConfig = preservedConfigFromSummary(
    objectValue(job.preserved_config_summary),
  );
  const optionalApps = optionalAppsFromPreservedConfig(preservedConfig);

  return compactObject({
    schemaVersion: CONTROLLER_SCHEMA_VERSION,
    contract: CONTROLLER_CONTRACT,
    phase: "update",
    action: "update",
    tenantId,
    jobId: job.id,
    sessionId: job.id,
    customerName: process.env.THINKWORK_DEPLOYMENT_DISPLAY_NAME || "ThinkWork",
    environmentName: stage,
    stage,
    awsAccountId: accountId,
    awsRegion: region,
    availabilityZones: [],
    source: "settings",
    evidenceBucket,
    evidence: {
      bucket: evidenceBucket,
      prefix: evidencePrefix,
      expectedArtifacts: [
        "controller-input-summary.json",
        "redacted-terraform-vars.json",
        "terraform-plan.json",
        "terraform-outputs.json",
        "deployment-evidence.json",
      ],
    },
    releaseVersion: release.version,
    releaseManifestUrl: release.manifestUrl,
    releaseManifestSha256: release.manifestSha256,
    releaseManifestSignatureUrl: release.manifestSignatureUrl,
    releaseManifestTrustPolicy: release.manifestTrustPolicy,
    terraformModuleVersion:
      job.terraform_module_version ??
      releaseVersionToTerraformModuleVersion(job.target_release_version),
    release,
    preservedConfig,
    ...preservedConfig,
    operation: {
      kind: "foundation",
      action: "update",
      plan: true,
      apply: true,
      destroy: false,
    },
    features: {
      baseInstall: {
        cognee: optionalApps.includes("cognee"),
        slack: false,
        stripe: false,
        twenty: optionalApps.includes("twenty"),
      },
      optionalApps,
    },
    terraform: {
      stateRecovery: {
        mode: "state",
        recoverByTags: false,
      },
    },
    statusPointer: compactObject({
      bucket: job.status_pointer_bucket ?? evidenceBucket,
      key: job.status_pointer_key ?? "deployment/status/current.json",
    }),
  });
}

function releaseSelection(job: ReleaseUpdateJobRow) {
  const manifest = objectValue(objectValue(job.preflight_summary).manifest);
  return compactObject({
    version: job.target_release_version,
    manifestUrl: job.manifest_url,
    manifestSha256: job.manifest_sha256,
    manifestSignatureUrl: stringValue(manifest.signatureUrl),
    manifestTrustPolicy: job.manifest_trust_policy,
  });
}

function preservedConfigFromSummary(
  summary: Record<string, unknown>,
): Record<string, unknown> {
  const fields = objectValue(summary.fields);
  const sesSender = objectValue(fields.sesSender);
  const optionalApps = objectValue(fields.optionalApps);
  return compactObject({
    customerDomain: stringValue(fields.customerDomain),
    customerDomainDelegated: booleanOrUndefined(fields.customerDomainDelegated),
    customerDomainLegacyRetired: booleanOrUndefined(
      fields.customerDomainLegacyRetired,
    ),
    platformOperatorEmails: stringValue(fields.platformOperatorEmails),
    cognitoEmailSourceArn: stringValue(sesSender.cognitoEmailSourceArn),
    cognitoFromEmailAddress: stringValue(sesSender.cognitoFromEmailAddress),
    cognitoReplyToEmailAddress: stringValue(
      sesSender.cognitoReplyToEmailAddress,
    ),
    appDomain: stringValue(fields.appDomain),
    appCertificateArn: stringValue(fields.appCertificateArn),
    enableHindsight: booleanOrUndefined(optionalApps.hindsight),
    enableCognee: booleanOrUndefined(optionalApps.cognee),
    twentyProvisioned: booleanOrUndefined(optionalApps.twenty),
  });
}

function optionalAppsFromPreservedConfig(
  preservedConfig: Record<string, unknown>,
): string[] {
  const apps: string[] = [];
  if (preservedConfig.enableCognee === true) apps.push("cognee");
  if (preservedConfig.twentyProvisioned === true) apps.push("twenty");
  return apps;
}

function releaseVersionToTerraformModuleVersion(version: string): string {
  return version.replace(/^v/, "");
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function stringValue(value: unknown): string | undefined {
  return typeof value === "string" && value.trim() ? value.trim() : undefined;
}

function booleanOrUndefined(value: unknown): boolean | undefined {
  return typeof value === "boolean" ? value : undefined;
}

function compactObject<T extends Record<string, unknown>>(value: T): T {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  ) as T;
}
