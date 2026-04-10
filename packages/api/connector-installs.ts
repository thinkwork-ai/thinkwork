import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdir, readFile } from "node:fs/promises";
import path from "node:path";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

interface APIGatewayProxyEvent {
  headers?: Record<string, string | undefined>;
  body?: string | null;
}

interface APIGatewayProxyResult {
  statusCode: number;
  headers?: Record<string, string>;
  body: string;
}

type ProvisionPhase = "package" | "skill" | "provisioning";

type ProvisionRequest = {
  assistantId?: string;
  gatewayId?: string;
  connectorKey?: string;
  packageName?: string;
  desiredVersion?: string;
  skillSourcePath?: string;
  gatewayBaseUrl?: string;
  gatewayToken?: string;
  targetSkillPath?: string;
};

function json(statusCode: number, body: unknown): APIGatewayProxyResult {
  return {
    statusCode,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

function fail(phase: ProvisionPhase, statusCode: number, error: string): APIGatewayProxyResult {
  return json(statusCode, { ok: false, lastPhase: phase, error });
}

function authToken(headers?: Record<string, string | undefined>) {
  const auth = headers?.authorization || headers?.Authorization;
  if (!auth) return null;
  return auth.startsWith("Bearer ") ? auth.slice("Bearer ".length).trim() : null;
}

function sanitizePathSegment(value: string): string {
  return value.replace(/[^a-zA-Z0-9._-]+/g, "-");
}

function managedInstallRoot() {
  return (process.env.CONNECTOR_PROVISION_STAGING_ROOT || "/tmp/connectors").replace(/\/$/, "");
}

function resolveManagedInstallPath(connectorKey: string, packageName: string, desiredVersion: string) {
  const key = sanitizePathSegment(connectorKey || "connector");
  const pkg = sanitizePathSegment(packageName);
  const ver = sanitizePathSegment(desiredVersion || "latest");
  return path.join(managedInstallRoot(), key, `${pkg}-${ver}`);
}

function parsePackageRef(packageName: string, desiredVersion: string) {
  return `${packageName}@${desiredVersion || "latest"}`;
}

function nodeModulePackagePath(installPath: string, packageName: string) {
  return path.join(installPath, "node_modules", ...packageName.split("/"));
}

function nodeModulePackageJsonPath(installPath: string, packageName: string) {
  return path.join(nodeModulePackagePath(installPath, packageName), "package.json");
}

async function readInstalledVersion(installPath: string, packageName: string): Promise<string | null> {
  try {
    const raw = await readFile(nodeModulePackageJsonPath(installPath, packageName), "utf8");
    const pkg = JSON.parse(raw) as { version?: string };
    return pkg.version || null;
  } catch {
    return null;
  }
}

async function resolveBinPath(installPath: string, packageName: string): Promise<string | undefined> {
  try {
    const raw = await readFile(nodeModulePackageJsonPath(installPath, packageName), "utf8");
    const pkg = JSON.parse(raw) as { name?: string; bin?: string | Record<string, string> };
    if (!pkg.bin) return undefined;

    let binRel: string | undefined;
    if (typeof pkg.bin === "string") {
      binRel = pkg.bin;
    } else {
      const scopedTail = (pkg.name || packageName).split("/").pop() || packageName;
      binRel = pkg.bin[scopedTail] || Object.values(pkg.bin)[0];
    }
    return binRel ? path.join(installPath, "node_modules", ".bin", path.basename(binRel)) : undefined;
  } catch {
    return undefined;
  }
}

function digest(content: string): string {
  return createHash("sha256").update(content, "utf8").digest("hex");
}

async function readSkillSource({
  installPath,
  packageName,
  skillSourcePath,
}: {
  installPath: string;
  packageName: string;
  skillSourcePath: string;
}): Promise<{ sourceContent: string; sourceHash: string; sourcePath: string }> {
  const sourcePath = path.join(nodeModulePackagePath(installPath, packageName), skillSourcePath);
  const sourceContent = await readFile(sourcePath, "utf8");
  const sourceHash = digest(sourceContent);
  return { sourceContent, sourceHash, sourcePath };
}

function normalizeBaseUrl(url: string): string {
  return url.replace(/\/$/, "");
}

async function writeSkillToAssistantGateway({
  gatewayBaseUrl,
  gatewayToken,
  assistantSkillPath,
  sourceContent,
}: {
  gatewayBaseUrl: string;
  gatewayToken: string;
  assistantSkillPath: string;
  sourceContent: string;
}): Promise<void> {
  const res = await fetch(`${normalizeBaseUrl(gatewayBaseUrl)}/files/write`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${gatewayToken}`,
    },
    body: JSON.stringify({
      path: assistantSkillPath,
      content: sourceContent,
    }),
  });

  if (!res.ok) {
    const text = await res.text();
    throw new Error(`Failed to deploy skill to assistant path ${assistantSkillPath}: ${res.status} ${text}`);
  }
}

export async function handler(event: APIGatewayProxyEvent): Promise<APIGatewayProxyResult> {
  const expectedSecret = process.env.API_AUTH_SECRET;
  const token = authToken(event.headers);
  if (!expectedSecret || !token || token !== expectedSecret) {
    return json(401, { ok: false, error: "Unauthorized" });
  }

  let body: ProvisionRequest;
  try {
    body = event.body ? (JSON.parse(event.body) as ProvisionRequest) : {};
  } catch {
    return json(400, { ok: false, error: "Invalid JSON body" });
  }

  if (!body.connectorKey || !body.packageName) {
    return fail("provisioning", 400, "connectorKey and packageName are required");
  }

  if (!body.gatewayBaseUrl || !body.gatewayToken || !body.targetSkillPath) {
    return fail("provisioning", 400, "gatewayBaseUrl, gatewayToken, and targetSkillPath are required");
  }

  const desiredVersion = body.desiredVersion || "latest";
  const packageRef = parsePackageRef(body.packageName, desiredVersion);
  const skillSourcePath = body.skillSourcePath || "SKILL.md";
  const installPath = resolveManagedInstallPath(body.connectorKey, body.packageName, desiredVersion);

  let installedVersion: string | null = null;
  try {
    await mkdir(installPath, { recursive: true });

    installedVersion = await readInstalledVersion(installPath, body.packageName);
    if (!installedVersion || (desiredVersion !== "latest" && installedVersion !== desiredVersion)) {
      await execFileAsync(
        "npm",
        ["install", "--no-audit", "--no-fund", "--omit=dev", "--prefix", installPath, packageRef],
        {
          cwd: installPath,
          env: { ...process.env, HOME: process.env.HOME || "/tmp", npm_config_cache: process.env.npm_config_cache || "/tmp/.npm" },
          timeout: 120_000,
          maxBuffer: 2 * 1024 * 1024,
        },
      );
      installedVersion = await readInstalledVersion(installPath, body.packageName);
    }
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown package install error";
    return fail("package", 500, `Connector package install failed: ${message}`);
  }

  try {
    const skillSource = await readSkillSource({
      installPath,
      packageName: body.packageName,
      skillSourcePath,
    });

    await writeSkillToAssistantGateway({
      gatewayBaseUrl: body.gatewayBaseUrl,
      gatewayToken: body.gatewayToken,
      assistantSkillPath: body.targetSkillPath,
      sourceContent: skillSource.sourceContent,
    });

    const resolvedBinPath = await resolveBinPath(installPath, body.packageName);
    const verification = {
      assistantSkillPath: body.targetSkillPath,
      installPath,
      binPath: resolvedBinPath,
    };

    return json(200, {
      ok: true,
      status: "installed",
      installPath,
      skillInstallPath: body.targetSkillPath,
      assistantSkillPath: body.targetSkillPath,
      skillSourcePath,
      skillHash: skillSource.sourceHash,
      binPath: resolvedBinPath,
      installedVersion: installedVersion || desiredVersion,
      lastPhase: "provisioning",
      verification,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown skill install error";
    return fail("skill", 500, `Connector skill deploy failed: ${message}`);
  }
}
