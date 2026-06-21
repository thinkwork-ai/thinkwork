import { createHash, randomUUID } from "node:crypto";
import {
  BatchGetProjectsCommand,
  CodeBuildClient,
} from "@aws-sdk/client-codebuild";
import {
  GetPolicyCommand,
  GetPolicyVersionCommand,
  GetRolePolicyCommand,
  IAMClient,
  ListAttachedRolePoliciesCommand,
  ListRolePoliciesCommand,
} from "@aws-sdk/client-iam";
import {
  GetObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { GetParametersCommand, SSMClient } from "@aws-sdk/client-ssm";
import { releaseUpdateJobs } from "@thinkwork/database-pg/schema";
import {
  validateReleaseManifest,
  type ThinkWorkReleaseManifest,
} from "@thinkwork/release-manifest";
import { and, eq } from "drizzle-orm";
import { db } from "../../graphql/utils.js";
import {
  appendReleaseUpdateEvent,
  deploymentProfileConfigFromEnv,
  loadReleaseUpdateEvents,
  mergeDeploymentProfileConfig,
  resolveDeploymentProfileConfig,
  type DeploymentProfileConfig,
} from "../../graphql/resolvers/deployments/shared.js";

const RUNNER_SCRIPT_KEY = "runner/thinkwork-runner.py";
const STATUS_POINTER_KEY = "deployment/status/current.json";
const TRUST_POLICIES = new Set(["allow_unsigned_canary", "require_signature"]);

const s3 = new S3Client({});
const iam = new IAMClient({});
const codebuild = new CodeBuildClient({});
const ssm = new SSMClient({});

export type ReleaseUpdateJobRow = typeof releaseUpdateJobs.$inferSelect;

export interface StartReleaseUpdatePreflightArgs {
  tenantId: string;
  requestedByUserId: string | null;
  version: string;
  manifestUrl: string;
  manifestSha256: string;
  signatureUrl?: string | null;
  signed?: boolean | null;
  idempotencyKey?: string | null;
}

export interface ReleasePreflightDeps {
  fetch?: typeof fetch;
  profile?: DeploymentProfileConfig;
  readS3Object?: (bucket: string, key: string) => Promise<Uint8Array | null>;
  writeS3Object?: (
    bucket: string,
    key: string,
    body: Uint8Array | string,
    contentType?: string,
  ) => Promise<void>;
  readCodeBuildServiceRoleArn?: (projectName: string) => Promise<string | null>;
  readIamPolicyDocuments?: (
    roleArn: string,
  ) => Promise<Array<Record<string, unknown>>>;
  readReleaseSelection?: () => Promise<Partial<DeploymentProfileConfig>>;
  now?: () => Date;
}

export interface StartedReleaseUpdatePreflight {
  job: ReleaseUpdateJobRow;
  events: unknown[];
}

export interface RemediateReleaseRunnerArgs {
  tenantId: string;
  requestedByUserId: string | null;
  jobId: string;
  idempotencyKey?: string | null;
}

interface Blocker {
  category: string;
  message: string;
  recoveryAction: string;
}

interface Warning {
  category: string;
  message: string;
}

interface PreflightContext {
  profile: DeploymentProfileConfig;
  currentStatus: Record<string, unknown>;
  currentRelease: {
    version: string | null;
    manifestUrl: string | null;
    manifestSha256: string | null;
  };
  preservedConfig: Record<string, unknown> | null;
  preservedConfigSummary: Record<string, unknown>;
}

export async function startReleaseUpdatePreflightJob(
  args: StartReleaseUpdatePreflightArgs,
  deps: ReleasePreflightDeps = {},
): Promise<StartedReleaseUpdatePreflight> {
  const idempotencyKey = args.idempotencyKey?.trim() || randomUUID();
  const [existing] = await db
    .select()
    .from(releaseUpdateJobs)
    .where(
      and(
        eq(releaseUpdateJobs.tenant_id, args.tenantId),
        eq(releaseUpdateJobs.idempotency_key, idempotencyKey),
      ),
    )
    .limit(1);
  if (existing) {
    return {
      job: existing,
      events: await loadReleaseUpdateEvents(args.tenantId, existing.id),
    };
  }

  const blockers: Blocker[] = [];
  const warnings: Warning[] = [];
  const manifest = await fetchAndValidateManifest(args, deps.fetch ?? fetch);
  const profile = await resolvePreflightProfile(deps);
  const context = await resolvePreflightContext(profile, deps, blockers);
  const manifestTrust = releaseTrustPosture({
    args,
    manifest,
    profile,
    blockers,
    warnings,
  });
  const runner = await runnerCompatibility({
    manifest,
    profile,
    deps,
    blockers,
  });
  const iamDrift = await detectIamDrift({
    profile,
    preservedConfig: context.preservedConfig,
    deps,
    blockers,
    warnings,
  });

  if (context.currentRelease.version === args.version) {
    warnings.push({
      category: "already_current",
      message: `The environment already reports ${args.version} as active.`,
    });
  }

  const remediationSummary = {
    runnerRefresh:
      runner.status === "mismatch"
        ? {
            required: true,
            available: Boolean(manifest.components.deploymentRunner.script.url),
            source: manifest.components.deploymentRunner.script,
            recoveryAction:
              "Refresh the S3 runner from the selected trusted release, then rerun preflight.",
          }
        : { required: false },
    iam:
      iamDrift.status === "missing_route53"
        ? {
            required: true,
            mode: "detect_and_block",
            recoveryAction:
              "Update the deployment CodeBuild role through a reviewed infrastructure change, then rerun preflight.",
          }
        : { required: false },
  };
  const status = blockers.length > 0 ? "preflight_blocked" : "preflight_ready";
  const firstBlocker = blockers[0] ?? null;
  const jobId = randomUUID();
  const preflightSummary = {
    blocked: blockers.length > 0,
    blockers,
    warnings,
    currentRelease: context.currentRelease,
    targetRelease: {
      version: args.version,
      manifestUrl: args.manifestUrl,
      manifestSha256: args.manifestSha256,
      terraformModuleVersion: manifest.components.terraform.version,
    },
    manifest: manifestTrust,
    compatibility: {
      minCliVersion: manifest.compatibility.minCliVersion,
      minRunnerVersion: manifest.compatibility.minRunnerVersion,
      profileSchemaVersion: manifest.compatibility.profileSchemaVersion,
    },
    runner,
    iam: iamDrift,
    statusPointer: {
      bucket: profile.evidenceBucket,
      key: profile.evidenceBucket ? STATUS_POINTER_KEY : null,
      loaded: Object.keys(context.currentStatus).length > 0,
    },
  };
  const [job] = await db
    .insert(releaseUpdateJobs)
    .values({
      id: jobId,
      tenant_id: args.tenantId,
      status,
      idempotency_key: idempotencyKey,
      requested_by_user_id: args.requestedByUserId,
      target_release_version: args.version,
      current_release_version: context.currentRelease.version,
      manifest_url: args.manifestUrl,
      manifest_sha256: args.manifestSha256.toLowerCase(),
      manifest_signed: manifestTrust.signed,
      manifest_trust_policy: manifestTrust.policy,
      terraform_module_version: manifest.components.terraform.version,
      preflight_summary: preflightSummary,
      preserved_config_summary: context.preservedConfigSummary,
      remediation_summary: remediationSummary,
      state_machine_arn: profile.stateMachineArn,
      evidence_bucket: profile.evidenceBucket,
      evidence_prefix: `release-updates/${jobId}/preflight`,
      status_pointer_bucket: profile.evidenceBucket,
      status_pointer_key: profile.evidenceBucket ? STATUS_POINTER_KEY : null,
      failure_category: firstBlocker?.category,
      failure_message: firstBlocker?.message,
      recovery_action: firstBlocker?.recoveryAction,
    })
    .returning();

  await appendReleaseUpdateEvent({
    tenantId: args.tenantId,
    jobId: job.id,
    eventType: status,
    message:
      status === "preflight_ready"
        ? `Release update preflight passed for ${args.version}.`
        : `Release update preflight blocked for ${args.version}.`,
    payload: {
      blockers,
      warnings,
      remediationSummary,
    },
    idempotencyKey: `${idempotencyKey}:${status}`,
  });

  return {
    job,
    events: await loadReleaseUpdateEvents(args.tenantId, job.id),
  };
}

export async function remediateReleaseRunnerJob(
  args: RemediateReleaseRunnerArgs,
  deps: ReleasePreflightDeps = {},
): Promise<StartedReleaseUpdatePreflight> {
  const [job] = await db
    .select()
    .from(releaseUpdateJobs)
    .where(
      and(
        eq(releaseUpdateJobs.tenant_id, args.tenantId),
        eq(releaseUpdateJobs.id, args.jobId),
      ),
    )
    .limit(1);
  if (!job) {
    throw new Error("Release update job was not found");
  }
  const runnerRefresh = runnerRefreshSummary(job);
  if (!runnerRefresh.required) {
    throw new Error("Release update job does not require runner remediation");
  }
  if (!job.evidence_bucket) {
    throw new Error("Release update job has no evidence bucket");
  }
  const source = runnerRefresh.source;
  if (!source?.url || !source.sha256) {
    throw new Error("Selected release does not provide runner script metadata");
  }
  if (!releaseTrustAllowsRunnerRemediation(job)) {
    throw new Error("Runner remediation requires a trusted release target");
  }

  const existing = await readS3Object(
    job.evidence_bucket,
    RUNNER_SCRIPT_KEY,
    deps,
  );
  if (!existing) {
    throw new Error("Current deployment runner script is missing");
  }
  const previousSha256 = sha256Hex(Buffer.from(existing));
  const targetBytes = await fetchRunnerScript(source.url, deps.fetch ?? fetch);
  const targetSha256 = sha256Hex(targetBytes);
  if (targetSha256 !== source.sha256) {
    throw new Error(
      `Runner script SHA-256 mismatch: expected ${source.sha256}, got ${targetSha256}`,
    );
  }

  const now = deps.now ? deps.now() : new Date();
  const timestamp = now.toISOString().replace(/[-:.]/g, "").replace("Z", "Z");
  const backupKey = `runner/backups/${timestamp}-${job.id}-thinkwork-runner.py`;
  const evidenceKey = `release-updates/${job.id}/runner-remediation/${timestamp}.json`;
  const evidence = {
    schemaVersion: 1,
    jobId: job.id,
    tenantId: args.tenantId,
    requestedByUserId: args.requestedByUserId,
    remediatedAt: now.toISOString(),
    runnerKey: RUNNER_SCRIPT_KEY,
    backupKey,
    targetSourceUrl: source.url,
    previousSha256,
    targetSha256,
  };
  await writeS3Object(
    job.evidence_bucket,
    backupKey,
    existing,
    "text/x-python",
    deps,
  );
  await writeS3Object(
    job.evidence_bucket,
    RUNNER_SCRIPT_KEY,
    targetBytes,
    "text/x-python",
    deps,
  );
  await writeS3Object(
    job.evidence_bucket,
    evidenceKey,
    `${JSON.stringify(evidence, null, 2)}\n`,
    "application/json",
    deps,
  );

  const preflightSummary = updatePreflightAfterRunnerRemediation(
    objectValue(job.preflight_summary),
    {
      previousSha256,
      targetSha256,
      backupKey,
      evidenceKey,
      remediatedAt: now.toISOString(),
    },
  );
  const remediationSummary = {
    ...objectValue(job.remediation_summary),
    runnerRefresh: {
      ...runnerRefresh,
      required: false,
      completed: true,
      backupKey,
      evidenceKey,
      previousSha256,
      targetSha256,
      remediatedAt: now.toISOString(),
    },
  };
  const remainingBlockers = Array.isArray(preflightSummary.blockers)
    ? preflightSummary.blockers
    : [];
  const status =
    remainingBlockers.length > 0 ? "preflight_blocked" : "runner_remediated";
  const firstBlocker = remainingBlockers[0] as Blocker | undefined;
  const [updated] = await db
    .update(releaseUpdateJobs)
    .set({
      status,
      preflight_summary: preflightSummary,
      remediation_summary: remediationSummary,
      failure_category: firstBlocker?.category,
      failure_message: firstBlocker?.message,
      recovery_action: firstBlocker?.recoveryAction,
      updated_at: new Date(),
    })
    .where(eq(releaseUpdateJobs.id, job.id))
    .returning();

  const idempotencyKey =
    args.idempotencyKey?.trim() || `${job.id}:runner-remediated`;
  await appendReleaseUpdateEvent({
    tenantId: args.tenantId,
    jobId: job.id,
    eventType: "runner_remediated",
    message:
      "Deployment runner script was refreshed from the selected release.",
    payload: evidence,
    idempotencyKey,
  });

  return {
    job: updated ?? job,
    events: await loadReleaseUpdateEvents(args.tenantId, job.id),
  };
}

async function fetchAndValidateManifest(
  args: StartReleaseUpdatePreflightArgs,
  fetchImpl: typeof fetch,
): Promise<ThinkWorkReleaseManifest> {
  const response = await fetchImpl(args.manifestUrl, {
    headers: { "User-Agent": "thinkwork-deployment-preflight" },
  });
  if (!response.ok) {
    throw new Error("Unable to load release manifest for preflight");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  const digest = sha256Hex(bytes);
  if (digest !== args.manifestSha256.toLowerCase()) {
    throw new Error(
      `Release manifest SHA-256 mismatch: expected ${args.manifestSha256}, got ${digest}`,
    );
  }
  const manifest = validateReleaseManifest(JSON.parse(bytes.toString("utf8")));
  if (manifest.release.version !== args.version) {
    throw new Error(
      `Release manifest version mismatch: expected ${args.version}, got ${manifest.release.version}`,
    );
  }
  return manifest;
}

async function resolvePreflightProfile(
  deps: ReleasePreflightDeps,
): Promise<DeploymentProfileConfig> {
  const deployed = deps.profile ?? (await resolveDeploymentProfileConfig());
  const env = deploymentProfileConfigFromEnv();
  const ssmSelection =
    deps.readReleaseSelection !== undefined
      ? await deps.readReleaseSelection()
      : await readReleaseSelectionFromSsm();
  return mergeDeploymentProfileConfig(
    compactProfile(ssmSelection),
    mergeDeploymentProfileConfig(deployed, env),
  );
}

async function resolvePreflightContext(
  profile: DeploymentProfileConfig,
  deps: ReleasePreflightDeps,
  blockers: Blocker[],
): Promise<PreflightContext> {
  const pointer = await readStatusPointer(profile, deps);
  const currentRelease = {
    version:
      stringAt(pointer, ["activeRelease", "version"]) ?? profile.releaseVersion,
    manifestUrl:
      stringAt(pointer, ["activeRelease", "manifestUrl"]) ??
      profile.releaseManifestUrl,
    manifestSha256:
      stringAt(pointer, ["activeRelease", "manifestSha256"]) ??
      profile.releaseManifestSha256,
  };
  const preservedConfig = await readPreservedConfig(profile, pointer, deps);
  const preservedConfigSummary = summarizePreservedConfig(preservedConfig);
  if (!preservedConfig) {
    blockers.push({
      category: "preserved_config_unavailable",
      message:
        "Previous redacted Terraform variables could not be read from deployment evidence.",
      recoveryAction:
        "Verify deployment/status/current.json and the last successful evidence prefix before dispatch.",
    });
  }
  return {
    profile,
    currentStatus: pointer,
    currentRelease,
    preservedConfig,
    preservedConfigSummary,
  };
}

function releaseTrustPosture(args: {
  args: StartReleaseUpdatePreflightArgs;
  manifest: ThinkWorkReleaseManifest;
  profile: DeploymentProfileConfig;
  blockers: Blocker[];
  warnings: Warning[];
}) {
  const policy = normalizeTrustPolicy(args.profile.releaseManifestTrustPolicy);
  const signatureUrl = args.args.signatureUrl || null;
  const signed = Boolean(args.args.signed || signatureUrl);
  if (policy === "require_signature" && !signed) {
    args.blockers.push({
      category: "manifest_signature_required",
      message:
        "This environment requires signed release manifests, but the selected release has no signature.",
      recoveryAction: "Choose a signed release or update the release assets.",
    });
  }
  if (
    policy === "allow_unsigned_canary" &&
    !signed &&
    !args.args.version.includes("canary")
  ) {
    args.blockers.push({
      category: "unsigned_non_canary_manifest",
      message:
        "Unsigned release manifests are allowed only for explicit canary releases.",
      recoveryAction: "Choose a signed release for customer-safe upgrades.",
    });
  }
  if (signed && !args.profile.releaseManifestTrustedKeysJson) {
    args.warnings.push({
      category: "signature_not_verified",
      message:
        "A signature URL is present, but trusted release keys are not available to this API process.",
    });
  }
  return {
    policy,
    signed,
    signatureUrl: signatureUrl ?? null,
    signatureVerified: false,
    acceptedKeyIds: args.manifest.signing.acceptedKeyIds,
    revokedKeyIds: args.manifest.signing.revokedKeyIds,
  };
}

async function runnerCompatibility(args: {
  manifest: ThinkWorkReleaseManifest;
  profile: DeploymentProfileConfig;
  deps: ReleasePreflightDeps;
  blockers: Blocker[];
}) {
  const target = args.manifest.components.deploymentRunner.script;
  if (!args.profile.evidenceBucket) {
    args.blockers.push({
      category: "runner_unavailable",
      message:
        "Deployment evidence bucket is not configured, so the frozen runner cannot be inspected.",
      recoveryAction:
        "Repair the deployment profile before starting a release update.",
    });
    return {
      status: "unavailable",
      key: RUNNER_SCRIPT_KEY,
      currentSha256: null,
      targetSha256: target.sha256,
    };
  }
  const bytes = await readS3Object(
    args.profile.evidenceBucket,
    RUNNER_SCRIPT_KEY,
    args.deps,
  );
  if (!bytes) {
    args.blockers.push({
      category: "runner_unavailable",
      message: `Deployment runner script is missing at s3://${args.profile.evidenceBucket}/${RUNNER_SCRIPT_KEY}.`,
      recoveryAction:
        "Restore or refresh the deployment runner script, then rerun preflight.",
    });
    return {
      status: "unavailable",
      key: RUNNER_SCRIPT_KEY,
      currentSha256: null,
      targetSha256: target.sha256,
    };
  }
  const currentSha256 = sha256Hex(Buffer.from(bytes));
  const status = currentSha256 === target.sha256 ? "compatible" : "mismatch";
  if (status === "mismatch") {
    args.blockers.push({
      category: "runner_compatibility",
      message:
        "The frozen S3 deployment runner does not match the selected release runner.",
      recoveryAction:
        "Refresh the S3 runner from the selected release, then rerun preflight.",
    });
  }
  return {
    status,
    key: RUNNER_SCRIPT_KEY,
    currentSha256,
    targetSha256: target.sha256,
    targetRelativePath: target.relativePath,
    minRunnerVersion: args.manifest.compatibility.minRunnerVersion,
  };
}

async function detectIamDrift(args: {
  profile: DeploymentProfileConfig;
  preservedConfig: Record<string, unknown> | null;
  deps: ReleasePreflightDeps;
  blockers: Blocker[];
  warnings: Warning[];
}) {
  const customerDomain = stringValue(args.preservedConfig?.customer_domain);
  const requiresRoute53 = Boolean(customerDomain);
  if (!requiresRoute53) {
    return {
      status: "not_required",
      requiresRoute53,
      roleArn: null,
      customerDomain: customerDomain || null,
    };
  }
  if (!args.profile.runnerProjectName) {
    args.blockers.push({
      category: "iam_unavailable",
      message:
        "Deployment runner CodeBuild project name is not available, so IAM drift cannot be evaluated.",
      recoveryAction:
        "Repair the deployment profile before starting a customer-domain release update.",
    });
    return {
      status: "unavailable",
      requiresRoute53,
      roleArn: null,
      customerDomain,
    };
  }
  try {
    const roleArn =
      args.deps.readCodeBuildServiceRoleArn !== undefined
        ? await args.deps.readCodeBuildServiceRoleArn(
            args.profile.runnerProjectName,
          )
        : await defaultReadCodeBuildServiceRoleArn(
            args.profile.runnerProjectName,
          );
    if (!roleArn) {
      throw new Error("CodeBuild service role was not returned");
    }
    const documents =
      args.deps.readIamPolicyDocuments !== undefined
        ? await args.deps.readIamPolicyDocuments(roleArn)
        : await defaultReadIamPolicyDocuments(roleArn);
    const hasRoute53 = documents.some(policyAllowsRoute53);
    if (!hasRoute53) {
      args.blockers.push({
        category: "iam_route53_missing",
        message:
          "The deployment CodeBuild role lacks Route53 permissions required for customer-domain updates.",
        recoveryAction:
          "Update the CodeBuild role policy through Terraform/reviewed infrastructure, then rerun preflight.",
      });
      return {
        status: "missing_route53",
        requiresRoute53,
        roleArn,
        customerDomain,
      };
    }
    return {
      status: "ok",
      requiresRoute53,
      roleArn,
      customerDomain,
    };
  } catch (error) {
    args.blockers.push({
      category: "iam_unavailable",
      message: `IAM drift could not be evaluated: ${(error as Error).message}`,
      recoveryAction:
        "Repair IAM read access or the deployment profile, then rerun preflight.",
    });
    return {
      status: "unavailable",
      requiresRoute53,
      roleArn: null,
      customerDomain,
      error: (error as Error).message,
    };
  }
}

async function readStatusPointer(
  profile: DeploymentProfileConfig,
  deps: ReleasePreflightDeps,
): Promise<Record<string, unknown>> {
  if (!profile.evidenceBucket) return {};
  const bytes = await readS3Object(
    profile.evidenceBucket,
    STATUS_POINTER_KEY,
    deps,
  );
  if (!bytes) return {};
  return parseJsonObject(Buffer.from(bytes).toString("utf8"));
}

async function readPreservedConfig(
  profile: DeploymentProfileConfig,
  pointer: Record<string, unknown>,
  deps: ReleasePreflightDeps,
): Promise<Record<string, unknown> | null> {
  if (!profile.evidenceBucket) return null;
  const evidenceKey = stringAt(pointer, [
    "lastSuccessfulDeployment",
    "evidenceKey",
  ]);
  if (!evidenceKey) return null;
  const redactedVarsKey = evidenceKey.replace(
    /[^/]+$/,
    "redacted-terraform-vars.json",
  );
  const bytes = await readS3Object(
    profile.evidenceBucket,
    redactedVarsKey,
    deps,
  );
  if (!bytes) return null;
  return parseJsonObject(Buffer.from(bytes).toString("utf8"));
}

function summarizePreservedConfig(varsJson: Record<string, unknown> | null) {
  if (!varsJson) {
    return {
      available: false,
      source: "deployment_evidence",
      fields: {},
    };
  }
  const fields = {
    customerDomain: stringValue(varsJson.customer_domain) || null,
    customerDomainDelegated: booleanValue(varsJson.customer_domain_delegated),
    customerDomainLegacyRetired: booleanValue(
      varsJson.customer_domain_legacy_retired,
    ),
    sesSender: {
      cognitoEmailSourceArn:
        stringValue(varsJson.cognito_email_source_arn) || null,
      cognitoFromEmailAddress:
        stringValue(varsJson.cognito_from_email_address) || null,
      cognitoReplyToEmailAddress:
        stringValue(varsJson.cognito_reply_to_email_address) || null,
    },
    platformOperatorEmails:
      stringValue(varsJson.platform_operator_emails) || null,
    googleOauthClientIdConfigured: Boolean(
      stringValue(varsJson.google_oauth_client_id),
    ),
    appDomain: stringValue(varsJson.app_domain) || null,
    appCertificateArn: stringValue(varsJson.app_certificate_arn) || null,
    optionalApps: {
      hindsight: booleanValue(varsJson.enable_hindsight),
      cognee: booleanValue(varsJson.enable_cognee),
      twenty: booleanValue(varsJson.twenty_provisioned),
      n8n: booleanValue(varsJson.n8n_provisioned),
    },
  };
  return {
    available: true,
    source: "deployment_evidence",
    fields,
  };
}

async function readS3Object(
  bucket: string,
  key: string,
  deps: ReleasePreflightDeps,
): Promise<Uint8Array | null> {
  if (deps.readS3Object) {
    return deps.readS3Object(bucket, key);
  }
  try {
    const response = await s3.send(
      new GetObjectCommand({ Bucket: bucket, Key: key }),
    );
    return response.Body ? await bodyToBytes(response.Body) : null;
  } catch (error) {
    const name = (error as Error)?.name;
    if (name === "NoSuchKey" || name === "NotFound") return null;
    throw error;
  }
}

async function writeS3Object(
  bucket: string,
  key: string,
  body: Uint8Array | string,
  contentType: string,
  deps: ReleasePreflightDeps,
) {
  if (deps.writeS3Object) {
    await deps.writeS3Object(bucket, key, body, contentType);
    return;
  }
  await s3.send(
    new PutObjectCommand({
      Bucket: bucket,
      Key: key,
      Body: typeof body === "string" ? body : Buffer.from(body),
      ContentType: contentType,
      ServerSideEncryption: "AES256",
    }),
  );
}

async function fetchRunnerScript(
  url: string,
  fetchImpl: typeof fetch,
): Promise<Buffer> {
  const response = await fetchImpl(url, {
    headers: { "User-Agent": "thinkwork-deployment-preflight" },
  });
  if (!response.ok) {
    throw new Error("Unable to download selected release runner script");
  }
  return Buffer.from(await response.arrayBuffer());
}

function runnerRefreshSummary(job: ReleaseUpdateJobRow): {
  required: boolean;
  source?: { url?: string | null; sha256?: string | null };
  [key: string]: unknown;
} {
  const summary = objectValue(job.remediation_summary);
  const runnerRefresh = objectValue(summary.runnerRefresh);
  return {
    ...runnerRefresh,
    required: runnerRefresh.required === true,
    source: objectValue(runnerRefresh.source) as {
      url?: string | null;
      sha256?: string | null;
    },
  };
}

function releaseTrustAllowsRunnerRemediation(
  job: ReleaseUpdateJobRow,
): boolean {
  if (job.manifest_signed) return true;
  return (
    job.manifest_trust_policy === "allow_unsigned_canary" &&
    job.target_release_version.includes("canary")
  );
}

function updatePreflightAfterRunnerRemediation(
  summary: Record<string, unknown>,
  evidence: {
    previousSha256: string;
    targetSha256: string;
    backupKey: string;
    evidenceKey: string;
    remediatedAt: string;
  },
): Record<string, unknown> {
  const blockers = Array.isArray(summary.blockers)
    ? summary.blockers.filter((blocker) => {
        if (!blocker || typeof blocker !== "object") return true;
        return (
          (blocker as Record<string, unknown>).category !==
          "runner_compatibility"
        );
      })
    : [];
  return {
    ...summary,
    blocked: blockers.length > 0,
    blockers,
    runner: {
      ...objectValue(summary.runner),
      status: "remediated",
      currentSha256: evidence.targetSha256,
      previousSha256: evidence.previousSha256,
      backupKey: evidence.backupKey,
      remediationEvidenceKey: evidence.evidenceKey,
      remediatedAt: evidence.remediatedAt,
    },
  };
}

async function defaultReadCodeBuildServiceRoleArn(
  projectName: string,
): Promise<string | null> {
  const response = await codebuild.send(
    new BatchGetProjectsCommand({ names: [projectName] }),
  );
  return response.projects?.[0]?.serviceRole ?? null;
}

async function defaultReadIamPolicyDocuments(
  roleArn: string,
): Promise<Array<Record<string, unknown>>> {
  const roleName = roleArn.split("/").pop();
  if (!roleName) return [];
  const documents: Array<Record<string, unknown>> = [];
  const inline = await iam.send(
    new ListRolePoliciesCommand({ RoleName: roleName }),
  );
  for (const policyName of inline.PolicyNames ?? []) {
    const policy = await iam.send(
      new GetRolePolicyCommand({ RoleName: roleName, PolicyName: policyName }),
    );
    const document = parsePolicyDocument(policy.PolicyDocument);
    if (document) documents.push(document);
  }
  const attached = await iam.send(
    new ListAttachedRolePoliciesCommand({ RoleName: roleName }),
  );
  for (const policy of attached.AttachedPolicies ?? []) {
    if (!policy.PolicyArn) continue;
    const metadata = await iam.send(
      new GetPolicyCommand({ PolicyArn: policy.PolicyArn }),
    );
    const versionId = metadata.Policy?.DefaultVersionId;
    if (!versionId) continue;
    const version = await iam.send(
      new GetPolicyVersionCommand({
        PolicyArn: policy.PolicyArn,
        VersionId: versionId,
      }),
    );
    const document = parsePolicyDocument(version.PolicyVersion?.Document);
    if (document) documents.push(document);
  }
  return documents;
}

async function readReleaseSelectionFromSsm(): Promise<
  Partial<DeploymentProfileConfig>
> {
  const stage = process.env.STAGE || process.env.THINKWORK_STAGE || "";
  if (!stage) return {};
  try {
    const names = [
      `/thinkwork/${stage}/deployment/selected-release-signature-url`,
      `/thinkwork/${stage}/deployment/selected-release-trust-policy`,
      `/thinkwork/${stage}/deployment/selected-release-trusted-keys-json`,
    ];
    const response = await ssm.send(new GetParametersCommand({ Names: names }));
    const values = Object.fromEntries(
      (response.Parameters ?? []).map((parameter) => [
        parameter.Name,
        parameter.Value,
      ]),
    );
    return {
      releaseManifestSignatureUrl:
        values[names[0]] && values[names[0]] !== "" ? values[names[0]] : null,
      releaseManifestTrustPolicy:
        values[names[1]] && values[names[1]] !== "" ? values[names[1]] : null,
      releaseManifestTrustedKeysJson:
        values[names[2]] && values[names[2]] !== "" ? values[names[2]] : null,
    };
  } catch (error) {
    console.warn(
      `[release-preflight] release selection SSM lookup failed: ${
        (error as Error).message
      }`,
    );
    return {};
  }
}

function parsePolicyDocument(value: unknown): Record<string, unknown> | null {
  if (!value) return null;
  if (typeof value === "object" && !Array.isArray(value)) {
    return value as Record<string, unknown>;
  }
  if (typeof value !== "string") return null;
  const decoded = value.startsWith("%7B") ? decodeURIComponent(value) : value;
  return parseJsonObject(decoded);
}

function policyAllowsRoute53(policy: Record<string, unknown>): boolean {
  const statements = Array.isArray(policy.Statement)
    ? policy.Statement
    : policy.Statement
      ? [policy.Statement]
      : [];
  return statements.some((statement) => {
    if (!statement || typeof statement !== "object") return false;
    const record = statement as Record<string, unknown>;
    if (String(record.Effect ?? "").toLowerCase() !== "allow") return false;
    return stringArray(record.Action).some((action) => {
      const normalized = action.toLowerCase();
      return (
        normalized === "*" ||
        normalized === "route53:*" ||
        normalized.startsWith("route53:")
      );
    });
  });
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function compactProfile(
  value: Partial<DeploymentProfileConfig>,
): DeploymentProfileConfig {
  return {
    releaseVersion: value.releaseVersion ?? null,
    releaseManifestUrl: value.releaseManifestUrl ?? null,
    releaseManifestSha256: value.releaseManifestSha256 ?? null,
    releaseManifestSignatureUrl: value.releaseManifestSignatureUrl ?? null,
    releaseManifestTrustPolicy: value.releaseManifestTrustPolicy ?? null,
    releaseManifestTrustedKeysJson:
      value.releaseManifestTrustedKeysJson ?? null,
    stateMachineArn: value.stateMachineArn ?? null,
    evidenceBucket: value.evidenceBucket ?? null,
    runnerProjectName: value.runnerProjectName ?? null,
  };
}

function normalizeTrustPolicy(value: string | null): string {
  const policy = value || "allow_unsigned_canary";
  return TRUST_POLICIES.has(policy) ? policy : "allow_unsigned_canary";
}

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

async function bodyToBytes(body: unknown): Promise<Uint8Array> {
  if (body instanceof Uint8Array) return body;
  if (typeof body === "string") return new TextEncoder().encode(body);
  if (
    body &&
    typeof body === "object" &&
    "transformToByteArray" in body &&
    typeof body.transformToByteArray === "function"
  ) {
    return body.transformToByteArray();
  }
  const chunks: Uint8Array[] = [];
  for await (const chunk of body as AsyncIterable<Uint8Array | string>) {
    chunks.push(
      typeof chunk === "string" ? new TextEncoder().encode(chunk) : chunk,
    );
  }
  return Buffer.concat(chunks);
}

function sha256Hex(bytes: Buffer): string {
  return createHash("sha256").update(bytes).digest("hex");
}

function stringAt(
  record: Record<string, unknown>,
  path: string[],
): string | null {
  let current: unknown = record;
  for (const key of path) {
    if (!current || typeof current !== "object" || Array.isArray(current)) {
      return null;
    }
    current = (current as Record<string, unknown>)[key];
  }
  return stringValue(current) || null;
}

function stringValue(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function booleanValue(value: unknown): boolean {
  return value === true || value === "true";
}

function stringArray(value: unknown): string[] {
  if (typeof value === "string") return [value];
  if (!Array.isArray(value)) return [];
  return value.filter((item): item is string => typeof item === "string");
}
