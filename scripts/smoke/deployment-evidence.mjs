import { execFileSync } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

export async function attachSmokeEvidence(kind, result, env = process.env) {
  const evidence = {
    schemaVersion: 1,
    kind,
    generatedAt: new Date().toISOString(),
    ok: result.ok !== false,
    release: {
      version: first(env.SMOKE_RELEASE_VERSION, env.THINKWORK_RELEASE_VERSION),
      previousVersion: first(
        env.SMOKE_PREVIOUS_RELEASE_VERSION,
        env.THINKWORK_PREVIOUS_RELEASE_VERSION,
      ),
      manifestDigest: first(
        env.SMOKE_MANIFEST_SHA256,
        env.THINKWORK_MANIFEST_SHA256,
      ),
      previousManifestDigest: first(
        env.SMOKE_PREVIOUS_MANIFEST_SHA256,
        env.THINKWORK_PREVIOUS_MANIFEST_SHA256,
      ),
    },
    aws: {
      stepFunctionsExecutionArn: first(
        env.SMOKE_STEP_FUNCTIONS_EXECUTION_ARN,
        env.AWS_STEP_FUNCTIONS_EXECUTION_ARN,
      ),
      codeBuildBuildArn: first(
        env.SMOKE_CODEBUILD_BUILD_ARN,
        env.CODEBUILD_BUILD_ARN,
      ),
      codeBuildBuildId: first(
        env.SMOKE_CODEBUILD_BUILD_ID,
        env.CODEBUILD_BUILD_ID,
      ),
      region: first(env.AWS_REGION, env.AWS_DEFAULT_REGION),
    },
    artifacts: {
      terraformPlanKey: first(env.SMOKE_TERRAFORM_PLAN_KEY),
      terraformApplyKey: first(env.SMOKE_TERRAFORM_APPLY_KEY),
      smokeResultKey: first(env.SMOKE_RESULT_KEY),
      cloudWatchLogsUrl: first(env.SMOKE_CLOUDWATCH_LOGS_URL),
    },
    result,
  };

  const evidenceFile = await writeEvidenceFile(evidence, env);
  const evidenceUri = evidenceFile
    ? await uploadEvidenceFile(evidenceFile, kind, env)
    : null;

  return {
    ...result,
    evidence: {
      ...evidence,
      file: evidenceFile,
      uri: evidenceUri,
    },
  };
}

async function writeEvidenceFile(evidence, env) {
  const explicit = first(env.SMOKE_EVIDENCE_FILE);
  const shouldWrite =
    explicit || env.SMOKE_WRITE_EVIDENCE === "1" || env.SMOKE_EVIDENCE_S3_URI;
  if (!shouldWrite) return null;

  const file =
    explicit ||
    path.join(
      fs.mkdtempSync(path.join(os.tmpdir(), "thinkwork-smoke-evidence-")),
      `${evidence.kind}-${Date.now()}.json`,
    );
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(evidence, null, 2)}\n`);
  return file;
}

async function uploadEvidenceFile(file, kind, env) {
  const base = first(env.SMOKE_EVIDENCE_S3_URI);
  if (!base) return null;
  const key = `${base.replace(/\/+$/, "")}/${kind}-${Date.now()}.json`;
  execFileSync("aws", ["s3", "cp", file, key], {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "pipe"],
  });
  return key;
}

function first(...values) {
  return (
    values.find((value) => typeof value === "string" && value.trim())?.trim() ??
    null
  );
}
