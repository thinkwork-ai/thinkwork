#!/usr/bin/env node
// thinkwork-managed: enterprise-deploy-template
import { createHash } from "node:crypto";
import { mkdir, readFile, rm, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { execFileSync } from "node:child_process";

const args = parseArgs(process.argv.slice(2));
const command = args._[0];

try {
  switch (command) {
    case "validate-manifest":
      await validateManifest();
      break;
    case "prepare":
      await prepareArtifacts();
      break;
    case "copy-runtime-images":
      await copyRuntimeImages();
      break;
    case "update-agentcore-runtimes":
      await updateAgentCoreRuntimes();
      break;
    case "sync-static":
      await syncStaticSites();
      break;
    case "record-overlay":
      await recordOverlay();
      break;
    case "write-summary":
      await writeSummary();
      break;
    default:
      throw new Error(`Unknown command: ${command ?? "(missing)"}`);
  }
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}

async function validateManifest() {
  const manifest = await readManifest(required("--manifest"));
  const expectedRelease = optional("--expected-release")?.replace(/^v/, "");
  if (manifest.schemaVersion !== 1) {
    throw new Error(
      `Unsupported release manifest schema ${manifest.schemaVersion}`,
    );
  }
  if (expectedRelease && manifest.release?.version !== expectedRelease) {
    throw new Error(
      `Release manifest version ${manifest.release?.version} does not match lock ${expectedRelease}`,
    );
  }
  for (const artifact of manifest.artifacts ?? []) {
    if (!artifact.url || !artifact.sha256 || !artifact.fileName) {
      throw new Error(
        `Release artifact ${artifact.name} is missing url, sha256, or fileName`,
      );
    }
  }
  console.log(`Validated ThinkWork release ${manifest.release.version}`);
}

async function prepareArtifacts() {
  const manifest = await readManifest(required("--manifest"));
  const workDir = required("--work-dir");
  const artifactBucket = required("--artifact-bucket");
  const lambdaPrefix = required("--lambda-prefix").replace(/^\/+|\/+$/g, "");
  const downloadDir = join(workDir, "downloads");
  await mkdir(downloadDir, { recursive: true });

  const prepared = [];
  for (const artifact of manifest.artifacts ?? []) {
    const localPath = join(downloadDir, artifact.fileName);
    await downloadAndVerify(artifact, localPath);
    prepared.push({ ...artifact, localPath });
    if (artifact.type === "lambda") {
      run("aws", [
        "s3",
        "cp",
        localPath,
        `s3://${artifactBucket}/${lambdaPrefix}/${artifact.fileName}`,
      ]);
    }
  }

  await writeJson(join(workDir, "prepared-artifacts.json"), {
    release: manifest.release,
    artifacts: prepared,
  });
}

async function copyRuntimeImages() {
  const manifest = await readManifest(required("--manifest"));
  const workDir = required("--work-dir");
  const stage = required("--stage");
  const repositoryUrl = required("--ecr-repository-url");
  const copied = [];

  for (const image of manifest.runtimeImages ?? []) {
    const runtime = runtimeName(image.name);
    const arch = image.architecture ?? "arm64";
    const releaseTag = sanitizeTag(
      `release-${manifest.release.version}-${image.name}`,
    );
    const stageTag = sanitizeTag(`${stage}-${runtime}-${arch}`);
    const releaseUri = `${repositoryUrl}:${releaseTag}`;
    const stageUri = `${repositoryUrl}:${stageTag}`;
    run("docker", [
      "buildx",
      "imagetools",
      "create",
      "--tag",
      releaseUri,
      "--tag",
      stageUri,
      image.uri,
    ]);
    copied.push({ ...image, runtime, releaseUri, stageUri });
  }

  await writeJson(join(workDir, "runtime-images.json"), copied);
}

async function updateAgentCoreRuntimes() {
  const workDir = required("--work-dir");
  const stage = required("--stage");
  const region = required("--region");
  const copied = await readJson(join(workDir, "runtime-images.json"), []);
  const updates = [];
  const accountId = awsText([
    "sts",
    "get-caller-identity",
    "--query",
    "Account",
    "--output",
    "text",
  ]);

  for (const runtime of ["strands", "flue"]) {
    const image = copied.find(
      (item) => item.runtime === runtime && item.architecture === "arm64",
    );
    if (!image) continue;
    const runtimeId = findAgentCoreRuntimeId({ stage, runtime, region });
    if (!runtimeId) {
      if (runtime === "flue") {
        updates.push(
          createFlueAgentCoreRuntime({
            stage,
            region,
            accountId,
            imageUri: image.stageUri,
          }),
        );
        continue;
      }
      throw new Error(
        `No ${runtime} AgentCore runtime found in SSM or runtime list`,
      );
    }
    updates.push(
      updateAgentCoreRuntime({
        stage,
        runtime,
        runtimeId,
        region,
        accountId,
        imageUri: image.stageUri,
      }),
    );
  }

  await writeJson(join(workDir, "runtime-updates.json"), updates);
}

function findAgentCoreRuntimeId({ stage, runtime, region }) {
  const parameterValue = awsText([
    "ssm",
    "get-parameter",
    "--name",
    `/thinkwork/${stage}/agentcore/runtime-id-${runtime}`,
    "--region",
    region,
    "--query",
    "Parameter.Value",
    "--output",
    "text",
  ]);
  if (parameterValue && parameterValue !== "None") return parameterValue;

  const runtimeNameValue = `thinkwork_${stage}_${runtime}`;
  const listed = awsText([
    "bedrock-agentcore-control",
    "list-agent-runtimes",
    "--region",
    region,
    "--query",
    `agentRuntimes[?agentRuntimeName=='${runtimeNameValue}'].agentRuntimeId | [0]`,
    "--output",
    "text",
  ]);
  return listed && listed !== "None" ? listed : "";
}

function createFlueAgentCoreRuntime({ stage, region, accountId, imageUri }) {
  if (!accountId) {
    throw new Error("AWS account ID is required to create the Flue runtime");
  }
  const runtimeNameValue = `thinkwork_${stage}_flue`;
  const runtimeId = awsText([
    "bedrock-agentcore-control",
    "create-agent-runtime",
    "--region",
    region,
    "--agent-runtime-name",
    runtimeNameValue,
    "--agent-runtime-artifact",
    `containerConfiguration={containerUri=${imageUri}}`,
    "--role-arn",
    canonicalAgentCoreRoleArn({ stage, runtime: "flue", accountId }),
    "--network-configuration",
    "networkMode=PUBLIC",
    "--protocol-configuration",
    "serverProtocol=HTTP",
    "--query",
    "agentRuntimeId",
    "--output",
    "text",
  ]);
  if (!runtimeId) {
    throw new Error(`Failed to create ${runtimeNameValue}`);
  }
  run("aws", [
    "ssm",
    "put-parameter",
    "--name",
    `/thinkwork/${stage}/agentcore/runtime-id-flue`,
    "--value",
    runtimeId,
    "--type",
    "String",
    "--overwrite",
    "--region",
    region,
  ]);
  waitForAgentCoreRuntime({ runtime: "flue", runtimeId, region, imageUri });
  return {
    runtime: "flue",
    status: "created",
    image: imageUri,
    runtimeId,
  };
}

function updateAgentCoreRuntime({
  stage,
  runtime,
  runtimeId,
  region,
  accountId,
  imageUri,
}) {
  const current = awsJson([
    "bedrock-agentcore-control",
    "get-agent-runtime",
    "--region",
    region,
    "--agent-runtime-id",
    runtimeId,
    "--output",
    "json",
  ]);
  const roleArn = accountId
    ? canonicalAgentCoreRoleArn({ stage, runtime, accountId })
    : current.roleArn;
  if (!roleArn) {
    throw new Error(
      `Existing ${runtime} runtime ${runtimeId} did not report roleArn`,
    );
  }
  run("aws", [
    "bedrock-agentcore-control",
    "update-agent-runtime",
    "--region",
    region,
    "--agent-runtime-id",
    runtimeId,
    "--role-arn",
    roleArn,
    "--network-configuration",
    `networkMode=${current.networkConfiguration?.networkMode ?? "PUBLIC"}`,
    "--protocol-configuration",
    `serverProtocol=${current.protocolConfiguration?.serverProtocol ?? "HTTP"}`,
    "--agent-runtime-artifact",
    `containerConfiguration={containerUri=${imageUri}}`,
  ]);
  waitForAgentCoreRuntime({ runtime, runtimeId, region, imageUri });
  return {
    runtime,
    status: "updated",
    image: imageUri,
    runtimeId,
    roleArn,
  };
}

function waitForAgentCoreRuntime({
  runtime,
  runtimeId,
  region,
  imageUri,
  waitSeconds = 900,
}) {
  const deadline = Date.now() + waitSeconds * 1000;
  while (Date.now() < deadline) {
    const detail = awsJson([
      "bedrock-agentcore-control",
      "get-agent-runtime",
      "--region",
      region,
      "--agent-runtime-id",
      runtimeId,
      "--output",
      "json",
    ]);
    const endpoints = awsJson([
      "bedrock-agentcore-control",
      "list-agent-runtime-endpoints",
      "--region",
      region,
      "--agent-runtime-id",
      runtimeId,
      "--output",
      "json",
    ]);
    const endpoint = endpoints.runtimeEndpoints?.find(
      (item) => item.name === "DEFAULT",
    );
    const status = detail.status ?? "UNKNOWN";
    const version = detail.agentRuntimeVersion ?? null;
    const currentImage =
      detail.agentRuntimeArtifact?.containerConfiguration?.containerUri ?? "";
    const endpointStatus = endpoint?.status ?? "MISSING";
    const liveVersion = endpoint?.liveVersion ?? null;
    const targetVersion = endpoint?.targetVersion ?? null;

    if (
      status === "READY" &&
      endpointStatus === "READY" &&
      (targetVersion === null ||
        targetVersion === "None" ||
        targetVersion === undefined) &&
      liveVersion === version &&
      currentImage === imageUri
    ) {
      return;
    }
    console.log(
      `Waiting for ${runtime} runtime ${runtimeId}: runtime=${status} endpoint=${endpointStatus} live=${liveVersion} target=${targetVersion} image=${currentImage}`,
    );
    run("sleep", ["15"]);
  }
  throw new Error(
    `Timed out waiting for ${runtime} AgentCore runtime ${runtimeId} to serve ${imageUri}`,
  );
}

function canonicalAgentCoreRoleArn({ stage, runtime, accountId }) {
  const roleName =
    runtime === "flue"
      ? `thinkwork-${stage}-agentcore-flue-role`
      : `thinkwork-${stage}-agentcore-role`;
  return `arn:aws:iam::${accountId}:role/${roleName}`;
}

async function syncStaticSites() {
  const manifest = await readManifest(required("--manifest"));
  const workDir = required("--work-dir");
  const terraformDir = required("--terraform-dir");
  const prepared = await readJson(join(workDir, "prepared-artifacts.json"), {
    artifacts: [],
  });
  const downloadByName = new Map(
    prepared.artifacts.map((artifact) => [artifact.name, artifact.localPath]),
  );
  const synced = [];

  for (const artifact of manifest.artifacts?.filter(
    (item) => item.type === "static-site",
  ) ?? []) {
    const localPath = downloadByName.get(artifact.name);
    if (!localPath) {
      throw new Error(`Static artifact ${artifact.name} was not prepared`);
    }
    const extractDir = join(workDir, "static", artifact.name);
    await rm(extractDir, { recursive: true, force: true });
    await mkdir(extractDir, { recursive: true });
    run("tar", ["-xzf", localPath, "-C", extractDir]);
    const bucket = terraformOutput(
      terraformDir,
      `${artifact.name}_bucket_name`,
    );
    if (!bucket) {
      throw new Error(
        `Terraform output ${artifact.name}_bucket_name is missing`,
      );
    }
    run("aws", ["s3", "sync", "--delete", extractDir, `s3://${bucket}/`]);
    const distributionId = terraformOutput(
      terraformDir,
      `${artifact.name}_distribution_id`,
    );
    if (distributionId) {
      run("aws", [
        "cloudfront",
        "create-invalidation",
        "--distribution-id",
        distributionId,
        "--paths",
        "/*",
      ]);
    }
    synced.push({
      name: artifact.name,
      bucket,
      distributionId: distributionId || null,
    });
  }

  await writeJson(join(workDir, "static-sync.json"), synced);
}

async function recordOverlay() {
  const stage = required("--stage");
  const deployment = JSON.parse(
    await readFile(required("--deployment"), "utf8"),
  );
  const workDir = required("--work-dir");
  const stageConfig = deployment.stages?.[stage];
  if (!stageConfig) {
    throw new Error(`customer/deployment.json does not define stage ${stage}`);
  }
  await writeJson(join(workDir, "overlay-report.json"), {
    status: "recorded",
    stage,
    tenantSlug: stageConfig.tenantSlug,
    evalPacks: stageConfig.evalPacks ?? [],
    seedPacks: stageConfig.seedPacks ?? [],
    skillPacks: stageConfig.skillPacks ?? [],
    workspaceDefaultPacks: stageConfig.workspaceDefaultPacks ?? [],
    branding: stageConfig.branding ?? null,
  });
}

async function writeSummary() {
  const manifest = await readManifest(required("--manifest"));
  const workDir = required("--work-dir");
  const terraformDir = required("--terraform-dir");
  const summary = {
    stage: required("--stage"),
    component: required("--component"),
    release: manifest.release,
    artifacts: await readJson(join(workDir, "prepared-artifacts.json"), null),
    runtimeImages: await readJson(join(workDir, "runtime-images.json"), []),
    runtimeUpdates: await readJson(join(workDir, "runtime-updates.json"), []),
    staticSync: await readJson(join(workDir, "static-sync.json"), []),
    overlay: await readJson(join(workDir, "overlay-report.json"), {
      status: "not-run",
    }),
    smokes: await readJson(join(workDir, "smoke-summary.json"), {
      status: "not-run",
    }),
    outputs: terraformOutputs(terraformDir),
  };
  await writeJson(required("--output"), summary);
}

async function downloadAndVerify(artifact, localPath) {
  await mkdir(dirname(localPath), { recursive: true });
  const response = await fetch(artifact.url);
  if (!response.ok || !response.body) {
    throw new Error(`Failed to download ${artifact.name}: ${response.status}`);
  }
  await writeFile(localPath, Buffer.from(await response.arrayBuffer()));
  const actual = await sha256File(localPath);
  if (actual !== artifact.sha256) {
    throw new Error(`Checksum mismatch for ${artifact.name}: got ${actual}`);
  }
}

function terraformOutputs(terraformDir) {
  const names = [
    "api_endpoint",
    "admin_url",
    "computer_url",
    "docs_url",
    "ecr_repository_url",
  ];
  return Object.fromEntries(
    names.map((name) => [name, terraformOutput(terraformDir, name) || null]),
  );
}

function terraformOutput(terraformDir, name) {
  return safeText("terraform", [
    "-chdir=" + terraformDir,
    "output",
    "-raw",
    name,
  ]);
}

function awsText(args) {
  return safeText("aws", args);
}

function awsJson(args) {
  const output = execFileSync("aws", args, {
    encoding: "utf8",
    stdio: ["ignore", "pipe", "inherit"],
  }).trim();
  return output ? JSON.parse(output) : {};
}

function safeText(commandName, commandArgs) {
  try {
    return execFileSync(commandName, commandArgs, {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function run(commandName, commandArgs) {
  execFileSync(commandName, commandArgs, { stdio: "inherit" });
}

async function readManifest(path) {
  return JSON.parse(await readFile(path, "utf8"));
}

async function readJson(path, fallback) {
  try {
    return JSON.parse(await readFile(path, "utf8"));
  } catch {
    return fallback;
  }
}

async function writeJson(path, value) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify(value, null, 2)}\n`, "utf8");
}

async function sha256File(path) {
  const hash = createHash("sha256");
  const file = await readFile(path);
  hash.update(file);
  return hash.digest("hex");
}

function runtimeName(name) {
  if (name.includes("flue")) return "flue";
  if (name.includes("strands")) return "strands";
  return name;
}

function sanitizeTag(value) {
  return value.replace(/[^A-Za-z0-9_.-]/g, "-").slice(0, 128);
}

function parseArgs(argv) {
  const parsed = { _: [] };
  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (!arg.startsWith("--")) {
      parsed._.push(arg);
      continue;
    }
    const value = argv[index + 1];
    if (!value || value.startsWith("--")) {
      parsed[arg] = true;
    } else {
      parsed[arg] = value;
      index += 1;
    }
  }
  return parsed;
}

function required(flag) {
  const value = args[flag];
  if (typeof value !== "string" || value.length === 0) {
    throw new Error(`${flag} is required`);
  }
  return value;
}

function optional(flag) {
  const value = args[flag];
  return typeof value === "string" ? value : undefined;
}
