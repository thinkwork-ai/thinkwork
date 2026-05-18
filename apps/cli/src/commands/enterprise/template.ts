import {
  existsSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

import { validateStage } from "../../config.js";

const __dirname = dirname(fileURLToPath(import.meta.url));

const MANAGED_MARKER = "thinkwork-managed: enterprise-deploy-template";
const CUSTOMER_SLUG_PATTERN = /^[a-z][a-z0-9-]{1,38}[a-z0-9]$/;

export interface EnterpriseDeployRepoTemplateOptions {
  targetDir: string;
  customerSlug: string;
  stages?: string[];
  region?: string;
  accountId?: string;
  releaseVersion?: string;
  releaseManifestUrl?: string;
  releaseManifestSha256?: string;
  terraformModuleVersion?: string;
  artifactBucket?: string;
}

export interface EnterpriseDeployRepoTemplateResult {
  targetDir: string;
  written: string[];
  preserved: string[];
}

export function renderEnterpriseDeployRepoTemplate(
  options: EnterpriseDeployRepoTemplateOptions,
): EnterpriseDeployRepoTemplateResult {
  const customerSlug = validateCustomerSlug(options.customerSlug);
  const stages = validateStages(options.stages ?? ["dev", "prod"]);
  const targetDir = resolve(options.targetDir);
  const templateRoot = findEnterpriseTemplateRoot();
  const replacements = buildTemplateReplacements({
    ...options,
    customerSlug,
    stages,
  });

  const templateFiles = listTemplateFiles(templateRoot).filter(
    (path) =>
      !relative(templateRoot, path).startsWith("terraform/stages/") &&
      !/^terraform\/backend-[^.]+\.hcl$/.test(
        relative(templateRoot, path).split("\\").join("/"),
      ),
  );
  const written: string[] = [];
  const preserved: string[] = [];

  for (const templatePath of templateFiles) {
    const relativePath = relative(templateRoot, templatePath);
    const outputPath = join(targetDir, relativePath);
    let content = applyTemplate(
      readFileSync(templatePath, "utf8"),
      replacements,
    );
    if (relativePath.split("\\").join("/") === "customer/deployment.json") {
      content = renderCustomerDeploymentJson(content, customerSlug, stages);
    }
    writeManagedFile(outputPath, content, written, preserved);
  }

  const stageTemplateRoot = join(templateRoot, "terraform", "stages");
  const backendTemplatePath = join(
    templateRoot,
    "terraform",
    "backend-dev.hcl",
  );
  for (const stage of stages) {
    const explicitTemplate = join(stageTemplateRoot, `${stage}.tfvars`);
    const fallbackTemplate = join(stageTemplateRoot, "dev.tfvars");
    const templatePath = existsSync(explicitTemplate)
      ? explicitTemplate
      : fallbackTemplate;
    const outputPath = join(
      targetDir,
      "terraform",
      "stages",
      `${stage}.tfvars`,
    );
    const content = applyTemplate(readFileSync(templatePath, "utf8"), {
      ...replacements,
      STAGE: stage,
    });
    writeManagedFile(outputPath, content, written, preserved);

    const backendPath = join(targetDir, "terraform", `backend-${stage}.hcl`);
    const backendContent = applyTemplate(
      readFileSync(backendTemplatePath, "utf8"),
      {
        ...replacements,
        STAGE: stage,
      },
    );
    writeManagedFile(backendPath, backendContent, written, preserved);
  }

  return { targetDir, written, preserved };
}

export function validateCustomerSlug(slug: string): string {
  const normalized = slug.trim();
  if (!CUSTOMER_SLUG_PATTERN.test(normalized)) {
    throw new Error(
      `Invalid customer slug "${slug}". Must be lowercase alphanumeric + hyphens, 3-40 characters, starting with a letter.`,
    );
  }
  return normalized;
}

export function validateStages(stages: string[]): string[] {
  const normalized = [
    ...new Set(stages.map((stage) => stage.trim()).filter(Boolean)),
  ];
  if (normalized.length === 0) {
    throw new Error("At least one deployment stage is required.");
  }

  for (const stage of normalized) {
    const check = validateStage(stage);
    if (!check.valid) {
      throw new Error(check.error ?? `Invalid stage name "${stage}".`);
    }
  }

  return normalized;
}

export function findEnterpriseTemplateRoot(): string {
  const candidates = [
    resolve(__dirname, "templates/deploy-repo"),
    resolve(__dirname, "commands/enterprise/templates/deploy-repo"),
  ];

  for (const candidate of candidates) {
    if (existsSync(join(candidate, "thinkwork.lock"))) return candidate;
  }

  throw new Error(
    "Enterprise deployment repo template not found. The CLI package may be incomplete.",
  );
}

function buildTemplateReplacements(
  options: Required<Pick<EnterpriseDeployRepoTemplateOptions, "customerSlug">> &
    Pick<
      EnterpriseDeployRepoTemplateOptions,
      | "accountId"
      | "artifactBucket"
      | "region"
      | "releaseManifestSha256"
      | "releaseManifestUrl"
      | "releaseVersion"
      | "stages"
      | "terraformModuleVersion"
    >,
): Record<string, string> {
  const releaseVersion = options.releaseVersion ?? "v0.0.0";
  const artifactBucket =
    options.artifactBucket ??
    `${options.customerSlug}-thinkwork-release-artifacts`;

  return {
    ACCOUNT_ID: options.accountId ?? "123456789012",
    ARTIFACT_BUCKET: artifactBucket,
    CUSTOMER_SLUG: options.customerSlug,
    LAMBDA_ARTIFACT_PREFIX: `releases/${releaseVersion}/lambdas`,
    REGION: options.region ?? "us-east-1",
    RELEASE_MANIFEST_SHA256: options.releaseManifestSha256 ?? "CHANGE_ME",
    RELEASE_MANIFEST_URL:
      options.releaseManifestUrl ??
      `https://github.com/thinkwork-ai/thinkwork/releases/download/${releaseVersion}/thinkwork-release.json`,
    RELEASE_VERSION: releaseVersion,
    TERRAFORM_MODULE_VERSION:
      options.terraformModuleVersion ?? releaseVersion.replace(/^v/, ""),
  };
}

function renderCustomerDeploymentJson(
  content: string,
  customerSlug: string,
  stages: string[],
): string {
  const deployment = JSON.parse(content);
  deployment.stages = Object.fromEntries(
    stages.map((stage) => [
      stage,
      {
        tenantSlug:
          stage === "prod" ? customerSlug : `${customerSlug}-${stage}`,
        evalPacks: [],
        seedPacks: [],
        skillPacks: [],
        workspaceDefaultPacks: [],
        branding: null,
      },
    ]),
  );
  return `${JSON.stringify(deployment, null, 2)}\n`;
}

function listTemplateFiles(root: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(root)) {
    const path = join(root, entry);
    const stat = statSync(path);
    if (stat.isDirectory()) {
      out.push(...listTemplateFiles(path));
    } else if (stat.isFile()) {
      out.push(path);
    }
  }
  return out.sort();
}

function applyTemplate(
  source: string,
  replacements: Record<string, string>,
): string {
  return source.replaceAll(/\{\{([A-Z0-9_]+)\}\}/g, (_match, key: string) => {
    if (!(key in replacements)) {
      throw new Error(`Unknown enterprise deployment template token: ${key}`);
    }
    return replacements[key];
  });
}

function writeManagedFile(
  path: string,
  content: string,
  written: string[],
  preserved: string[],
): void {
  mkdirSync(dirname(path), { recursive: true });

  if (existsSync(path)) {
    const current = readFileSync(path, "utf8");
    if (!current.includes(MANAGED_MARKER)) {
      preserved.push(path);
      return;
    }
  }

  writeFileSync(path, content);
  written.push(path);
}
