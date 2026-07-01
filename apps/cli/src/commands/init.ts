import { Command } from "commander";
import {
  existsSync,
  mkdirSync,
  readFileSync,
  writeFileSync,
  cpSync,
} from "node:fs";
import { resolve, join, dirname } from "node:path";
import { execSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { validateStage } from "../config.js";
import { getAwsIdentity } from "../aws.js";
import { saveEnvironment } from "../environments.js";
import { ensurePrerequisites } from "../prerequisites.js";
import { backendConfigArgs, ensureStateBackend } from "../lib/state-backend.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";
import { createInterface } from "node:readline";
import chalk from "chalk";

const __dirname = dirname(fileURLToPath(import.meta.url));

function ask(prompt: string, defaultVal = ""): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const suffix = defaultVal ? chalk.dim(` [${defaultVal}]`) : "";
  return new Promise((resolve) => {
    rl.question(`  ${prompt}${suffix}: `, (answer) => {
      rl.close();
      resolve(answer.trim() || defaultVal);
    });
  });
}

function choose(
  prompt: string,
  options: string[],
  defaultVal: string,
): Promise<string> {
  const optStr = options
    .map((o) => (o === defaultVal ? chalk.bold(o) : chalk.dim(o)))
    .join(" / ");
  return ask(`${prompt} (${optStr})`, defaultVal);
}

function generateSecret(length = 32): string {
  const chars =
    "abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789";
  let result = "";
  const bytes = new Uint8Array(length);
  globalThis.crypto.getRandomValues(bytes);
  for (const b of bytes) result += chars[b % chars.length];
  return result;
}

/**
 * Resolve the bundled Terraform modules directory.
 * When installed via npm: <pkg>/dist/terraform/ (sibling of cli.js in dist)
 * When running from repo: <repo>/terraform/ (three levels up from apps/cli/dist)
 */
function findBundledTerraform(): string {
  // Check npm package bundle first — scripts/bundle-terraform.js puts
  // modules at dist/terraform/, same directory as cli.js.
  const bundled = resolve(__dirname, "terraform");
  if (existsSync(join(bundled, "modules"))) return bundled;

  // Fallback: repo root (for development). __dirname is apps/cli/dist,
  // so three `..` reach the thinkwork repo root.
  const repoTf = resolve(__dirname, "..", "..", "..", "terraform");
  if (existsSync(join(repoTf, "modules"))) return repoTf;

  throw new Error(
    "Terraform modules not found. The CLI package may be incomplete.\n" +
      "Try reinstalling: npm install -g thinkwork-cli@latest",
  );
}

/**
 * Parse string-valued assignments from an existing terraform.tfvars.
 * Throws when the file has content but no parseable `stage` assignment —
 * a corrupt tfvars must never be silently overwritten (U4).
 */
export function parseTfvarsAssignments(
  content: string,
): Record<string, string> {
  const values: Record<string, string> = {};
  for (const line of content.split("\n")) {
    const match = line.match(/^\s*([a-zA-Z0-9_]+)\s*=\s*"([^"]*)"/);
    if (match) values[match[1]] = match[2];
  }
  const hasContent = content
    .split("\n")
    .some((l) => l.trim() && !l.trim().startsWith("#"));
  if (hasContent && !values.stage) {
    throw new Error(
      "Existing terraform.tfvars is unreadable (no stage assignment found). " +
        "Fix or remove it manually — init will not overwrite a file it cannot parse.",
    );
  }
  return values;
}

/**
 * Immutable answers (U4): an initialized directory is pinned to its stage,
 * account, and region. Changing them requires destroy + re-init, not a rerun.
 */
export function guardImmutableAnswers(
  existing: Record<string, string>,
  requested: { stage: string; account: string },
): { ok: boolean; error?: string } {
  if (existing.stage && existing.stage !== requested.stage) {
    return {
      ok: false,
      error:
        `This directory is initialized for stage "${existing.stage}", not "${requested.stage}". ` +
        `Run \`thinkwork destroy -s ${existing.stage}\` first, or init a new directory.`,
    };
  }
  if (existing.account_id && existing.account_id !== requested.account) {
    return {
      ok: false,
      error:
        `This directory is initialized for AWS account ${existing.account_id}, but the current ` +
        `credentials are account ${requested.account}. Switch profiles, or init a new directory.`,
    };
  }
  return { ok: true };
}

/**
 * Rerunning init must never rotate live secrets out from under deployed
 * resources: existing db_password/api_auth_secret are preserved byte-for-byte.
 */
export function mergePreservedSecrets(
  config: Record<string, string>,
  existing: Record<string, string>,
): void {
  if (existing.db_password) config.db_password = existing.db_password;
  if (existing.api_auth_secret) {
    config.api_auth_secret = existing.api_auth_secret;
  }
}

function buildTfvars(config: Record<string, string>): string {
  const lines: string[] = [
    `# Thinkwork — ${config.stage} stage`,
    `# Generated by: thinkwork init -s ${config.stage}`,
    `# ${new Date().toISOString().split("T")[0]}`,
    ``,
    `# ── Core ──────────────────────────────────────────────────────────`,
    `stage      = "${config.stage}"`,
    `region     = "${config.region}"`,
    `account_id = "${config.account_id}"`,
    ``,
    `# ── Database ──────────────────────────────────────────────────────`,
    `database_engine = "${config.database_engine}"`,
    `db_password     = "${config.db_password}"`,
    ``,
    `# ── Memory ────────────────────────────────────────────────────────`,
    `# Hindsight is the canonical user and Space memory provider for full installs.`,
    `# Set memory_engine = "agentcore" only for explicit low-cost/development mode.`,
    `enable_hindsight = ${config.enable_hindsight === "true"}`,
    `memory_engine    = ""`,
    ``,
    `# ── Ontology / Knowledge Graph ────────────────────────────────────`,
    `# Cognee is disabled by default. Enabling it also requires`,
    `# an immutable cognee_image_uri, dedicated DB secret ARN, and Bedrock ARNs.`,
    `enable_cognee = false`,
    ``,
    `# ── Managed Applications ──────────────────────────────────────────`,
    `# Twenty CRM is optional and disabled by default. Enabling it requires`,
    `# a pinned twenty_image_uri plus deploy-prepared database/encryption secrets.`,
    `twenty_provisioned     = false`,
    `twenty_runtime_enabled = false`,
    ``,
    `# ── Auth ──────────────────────────────────────────────────────────`,
    `api_auth_secret = "${config.api_auth_secret}"`,
  ];

  if (config.customer_domain) {
    lines.push(``);
    lines.push(
      `# ── Domain ────────────────────────────────────────────────────────`,
    );
    lines.push(
      `# customer_domain_delegated stays false until the domain's NS records`,
    );
    lines.push(
      `# point at the created hosted zone; flip it and rerun deploy to finish.`,
    );
    lines.push(`customer_domain           = "${config.customer_domain}"`);
    lines.push(
      `customer_domain_delegated = ${config.customer_domain_delegated === "true"}`,
    );
  }

  if (config.platform_operator_emails) {
    lines.push(``);
    lines.push(
      `platform_operator_emails = [${config.platform_operator_emails
        .split(",")
        .map((e) => `"${e.trim()}"`)
        .filter((e) => e !== '""')
        .join(", ")}]`,
    );
  }

  if (config.ses_parent_domain) {
    lines.push(``);
    lines.push(
      `# ── Email (SES) ───────────────────────────────────────────────────`,
    );
    lines.push(
      `# SES production access is a manual AWS approval (~24h). Until granted,`,
    );
    lines.push(
      `# email works in sandbox mode; \`thinkwork status\` tracks the approval.`,
    );
    lines.push(`ses_parent_domain = "${config.ses_parent_domain}"`);
  }

  if (config.google_oauth_client_id) {
    lines.push(``);
    lines.push(
      `# ── Google OAuth ──────────────────────────────────────────────────`,
    );
    lines.push(
      `google_oauth_client_id     = "${config.google_oauth_client_id}"`,
    );
    lines.push(
      `google_oauth_client_secret = "${config.google_oauth_client_secret}"`,
    );
  } else {
    lines.push(``);
    lines.push(
      `# ── Google OAuth (uncomment to enable Google social login) ────────`,
    );
    lines.push(`# google_oauth_client_id     = ""`);
    lines.push(`# google_oauth_client_secret = ""`);
  }

  if (config.admin_url && config.admin_url !== "http://localhost:5174") {
    lines.push(``);
    lines.push(
      `# ── Callback URLs ─────────────────────────────────────────────────`,
    );
    lines.push(
      `admin_callback_urls  = ["${config.admin_url}", "${config.admin_url}/auth/callback"]`,
    );
    lines.push(`admin_logout_urls    = ["${config.admin_url}"]`);
  }

  if (config.mobile_scheme && config.mobile_scheme !== "thinkwork") {
    lines.push(
      `mobile_callback_urls = ["${config.mobile_scheme}://", "${config.mobile_scheme}://auth/callback"]`,
    );
    lines.push(`mobile_logout_urls   = ["${config.mobile_scheme}://"]`);
  }

  lines.push(``);
  return lines.join("\n");
}

export function registerInitCommand(program: Command): void {
  program
    .command("init")
    .description(
      "Initialize a new Thinkwork environment. Prompts for a stage name in a TTY when omitted (init creates a stage — the picker isn't applicable here).",
    )
    .option("-s, --stage <name>", "Stage name (e.g. dev, staging, prod)")
    .option("-d, --dir <path>", "Target directory", ".")
    .option("--defaults", "Skip interactive prompts, use all defaults")
    .action(
      async (opts: { stage?: string; dir: string; defaults?: boolean }) => {
        let stage = opts.stage;
        if (!stage) {
          if (!process.stdin.isTTY) {
            printError(
              "Stage name is required. Pass -s <name> or re-run in an interactive terminal.",
            );
            process.exit(1);
          }
          const { input } = await import("@inquirer/prompts");
          try {
            stage = await input({
              message: "Stage name (e.g. dev, staging, prod):",
              validate: (v) => validateStage(v).error ?? true,
            });
          } catch (err) {
            if (err instanceof Error && err.name === "ExitPromptError") {
              console.log("  Cancelled.");
              return;
            }
            throw err;
          }
        }

        const stageCheck = validateStage(stage);
        if (!stageCheck.valid) {
          printError(stageCheck.error!);
          process.exit(1);
        }

        const identity = getAwsIdentity();
        printHeader("init", stage, identity);

        // Auto-install AWS CLI + Terraform if missing
        const prereqsOk = await ensurePrerequisites();
        if (!prereqsOk) {
          process.exit(1);
        }

        if (!identity) {
          printError(
            "AWS credentials not configured. Run `thinkwork login` first.",
          );
          process.exit(1);
        }

        // ── Resolve target directory ───────────────────────────────────

        const targetDir = resolve(opts.dir);
        const tfDir = join(targetDir, "terraform");
        const tfvarsPath = join(tfDir, "terraform.tfvars");

        let existing: Record<string, string> | null = null;
        if (existsSync(tfvarsPath)) {
          try {
            existing = parseTfvarsAssignments(readFileSync(tfvarsPath, "utf8"));
          } catch (err) {
            printError((err as Error).message);
            process.exit(1);
          }

          const guard = guardImmutableAnswers(existing!, {
            stage,
            account: identity.account,
          });
          if (!guard.ok) {
            printError(guard.error!);
            process.exit(1);
          }

          printWarning(
            `Existing environment detected at ${tfvarsPath} — secrets and immutable settings (stage, account, region) are preserved.`,
          );
          if (!opts.defaults) {
            const proceed = await ask(
              "Regenerate terraform.tfvars with preserved secrets?",
              "Y",
            );
            if (proceed.toLowerCase() === "n") {
              console.log("  Aborted.");
              return;
            }
          }
          console.log("");
        }

        // ── Collect configuration ──────────────────────────────────────

        const config: Record<string, string> = {
          stage: stage,
          account_id: identity.account,
          db_password: generateSecret(24),
          api_auth_secret: `tw-${stage}-${generateSecret(16)}`,
        };
        if (existing) mergePreservedSecrets(config, existing);

        if (opts.defaults) {
          config.region =
            existing?.region ??
            (identity.region !== "unknown" ? identity.region : "us-east-1");
          config.database_engine = "aurora-serverless";
          config.enable_hindsight = "true";
          config.google_oauth_client_id = "";
          config.google_oauth_client_secret = "";
          config.admin_url = "http://localhost:5174";
          config.mobile_scheme = "thinkwork";
          config.customer_domain = existing?.customer_domain ?? "";
          config.customer_domain_delegated = "false";
          config.platform_operator_emails =
            existing?.platform_operator_emails ?? "";
          config.ses_parent_domain = existing?.ses_parent_domain ?? "";
        } else {
          console.log(chalk.bold("  Configure your Thinkwork environment\n"));

          const defaultRegion =
            existing?.region ??
            (identity.region !== "unknown" ? identity.region : "us-east-1");
          config.region = await ask("AWS Region", defaultRegion);
          if (existing?.region && config.region !== existing.region) {
            printError(
              `Region is immutable for an initialized environment (currently "${existing.region}"). ` +
                `Run \`thinkwork destroy -s ${stage}\` and re-init to change it.`,
            );
            process.exit(1);
          }

          console.log("");
          console.log(chalk.dim("  ── Domain ──"));
          console.log(
            chalk.dim(
              "  A full environment serves the web app on your domain. DNS",
            ),
          );
          console.log(
            chalk.dim(
              "  delegation happens after the first deploy creates the hosted",
            ),
          );
          console.log(
            chalk.dim(
              "  zone; leave empty for a trial on raw CloudFront/API URLs.",
            ),
          );
          config.customer_domain = await ask(
            "Domain (e.g. thinkwork.acme.com; empty to skip)",
            existing?.customer_domain ?? "",
          );
          config.customer_domain_delegated = "false";

          config.platform_operator_emails = await ask(
            "Operator email(s), comma-separated",
            existing?.platform_operator_emails ?? "",
          );

          console.log("");
          console.log(chalk.dim("  ── Email (SES, optional) ──"));
          console.log(
            chalk.dim(
              "  SES production access is a manual AWS approval (~24h) — the",
            ),
          );
          console.log(
            chalk.dim(
              "  deploy proceeds without it and `thinkwork status` tracks it.",
            ),
          );
          const useSes = await ask("Configure SES email now? (y/N)", "N");
          if (useSes.toLowerCase() === "y") {
            config.ses_parent_domain = await ask(
              "SES parent domain",
              existing?.ses_parent_domain ?? config.customer_domain ?? "",
            );
          } else {
            config.ses_parent_domain = existing?.ses_parent_domain ?? "";
          }

          console.log("");
          console.log(chalk.dim("  ── Database ──"));
          config.database_engine = await choose(
            "Database engine",
            ["aurora-serverless", "rds-postgres"],
            "aurora-serverless",
          );

          console.log("");
          console.log(chalk.dim("  ── Memory ──"));
          console.log(
            chalk.dim(
              "  Hindsight is the canonical user and Space memory provider.",
            ),
          );
          console.log(
            chalk.dim("  AgentCore managed memory is available as an explicit"),
          );
          console.log(chalk.dim("  low-cost/development opt-out."));
          const hindsightAnswer = await ask(
            "Enable Hindsight long-term memory? (Y/n)",
            "Y",
          );
          config.enable_hindsight =
            hindsightAnswer.toLowerCase() === "n" ? "false" : "true";

          console.log("");
          console.log(chalk.dim("  ── Auth ──"));
          const useGoogle = await ask("Enable Google OAuth login? (y/N)", "N");
          if (useGoogle.toLowerCase() === "y") {
            config.google_oauth_client_id = await ask("Google OAuth Client ID");
            config.google_oauth_client_secret = await ask(
              "Google OAuth Client Secret",
            );
          } else {
            config.google_oauth_client_id = "";
            config.google_oauth_client_secret = "";
          }

          console.log("");
          console.log(chalk.dim("  ── Frontend URLs ──"));
          config.admin_url = await ask("Admin UI URL", "http://localhost:5174");
          config.mobile_scheme = await ask(
            "Mobile app URL scheme",
            "thinkwork",
          );

          console.log("");
          console.log(chalk.dim("  ── Secrets (auto-generated) ──"));
          console.log(
            chalk.dim(
              `  DB password:     ${config.db_password.slice(0, 8)}...`,
            ),
          );
          console.log(
            chalk.dim(
              `  API auth secret: ${config.api_auth_secret.slice(0, 16)}...`,
            ),
          );
        }

        // ── Scaffold Terraform files ───────────────────────────────────

        console.log("");
        console.log("  Scaffolding Terraform modules...");

        let bundledTf: string;
        try {
          bundledTf = findBundledTerraform();
        } catch (err) {
          printError(String(err));
          process.exit(1);
        }

        // Copy modules + examples + schema into target directory
        mkdirSync(tfDir, { recursive: true });

        const copyDirs = ["modules", "examples"];
        for (const dir of copyDirs) {
          const src = join(bundledTf, dir);
          const dst = join(tfDir, dir);
          if (existsSync(src) && !existsSync(dst)) {
            cpSync(src, dst, { recursive: true });
          }
        }

        const bundledPlugins = resolve(bundledTf, "..", "plugins");
        const targetPlugins = join(targetDir, "plugins");
        if (existsSync(bundledPlugins) && !existsSync(targetPlugins)) {
          cpSync(bundledPlugins, targetPlugins, { recursive: true });
        }

        // Copy schema.graphql
        const schemaPath = join(bundledTf, "schema.graphql");
        if (
          existsSync(schemaPath) &&
          !existsSync(join(tfDir, "schema.graphql"))
        ) {
          cpSync(schemaPath, join(tfDir, "schema.graphql"));
        }

        // Write terraform.tfvars at the root terraform/ dir (flat layout)
        const tfvars = buildTfvars(config);
        writeFileSync(tfvarsPath, tfvars);

        // Also write a main.tf that sources the composite module
        const mainTfPath = join(tfDir, "main.tf");
        if (!existsSync(mainTfPath)) {
          writeFileSync(
            mainTfPath,
            `################################################################################
# Thinkwork — ${config.stage}
# Generated by: thinkwork init -s ${config.stage}
################################################################################

terraform {
  required_version = ">= 1.5"

  # Partial backend: bucket/key/region/lock table are injected by the CLI via
  # -backend-config at \`terraform init\` (per-account state bucket, R11).
  backend "s3" {}

  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    archive = {
      source  = "hashicorp/archive"
      version = "~> 2.0"
    }
    null = {
      source  = "hashicorp/null"
      version = "~> 3.0"
    }
  }
}

provider "aws" {
  region = var.region
}

# us-east-1 alias required by the thinkwork module (configuration_aliases):
# CloudFront ACM certificates must live in us-east-1 regardless of stack region.
provider "aws" {
  alias  = "us_east_1"
  region = "us-east-1"
}

variable "stage" {
  type = string
}

variable "region" {
  type    = string
  default = "us-east-1"
}

variable "account_id" {
  type = string
}

variable "db_password" {
  type      = string
  sensitive = true
}

variable "database_engine" {
  type    = string
  default = "aurora-serverless"
}

variable "enable_hindsight" {
  type    = bool
  default = true
}

variable "enable_cognee" {
  type    = bool
  default = false
}

variable "cognee_image_uri" {
  type    = string
  default = ""
}

variable "cognee_db_username" {
  type    = string
  default = "thinkwork_cognee"
}

variable "cognee_db_name" {
  type    = string
  default = "thinkwork_cognee"
}

variable "cognee_db_password_secret_arn" {
  type    = string
  default = ""
}

variable "cognee_allowed_internal_cidr_blocks" {
  type    = list(string)
  default = []
}

variable "cognee_allowed_internal_security_group_ids" {
  type    = list(string)
  default = []
}

variable "cognee_backend_mode" {
  type    = string
  default = "dogfood"
}

variable "cognee_desired_count" {
  type    = number
  default = 1
}

variable "cognee_llm_provider" {
  type    = string
  default = "bedrock"
}

variable "cognee_llm_model" {
  type    = string
  default = "bedrock/amazon.nova-lite-v1:0"
}

variable "cognee_llm_api_key_secret_arn" {
  type    = string
  default = ""
}

variable "cognee_embedding_provider" {
  type    = string
  default = "bedrock"
}

variable "cognee_embedding_model" {
  type    = string
  default = "amazon.titan-embed-text-v2:0"
}

variable "cognee_embedding_dimensions" {
  type    = number
  default = 1024
}

variable "cognee_embedding_api_key_secret_arn" {
  type    = string
  default = ""
}

variable "cognee_vector_db_provider" {
  type    = string
  default = "lancedb"
}

variable "cognee_vector_db_url" {
  type    = string
  default = ""
}

variable "cognee_vector_db_key_secret_arn" {
  type    = string
  default = ""
}

variable "cognee_graph_database_provider" {
  type    = string
  default = "kuzu"
}

variable "cognee_graph_database_url" {
  type    = string
  default = ""
}

variable "cognee_graph_database_username" {
  type    = string
  default = ""
}

variable "cognee_graph_database_password_secret_arn" {
  type    = string
  default = ""
}

variable "cognee_bedrock_model_resource_arns" {
  type    = list(string)
  default = []
}

variable "cognee_kms_key_arns" {
  type    = list(string)
  default = []
}

variable "twenty_provisioned" {
  type    = bool
  default = false
}

variable "twenty_runtime_enabled" {
  type    = bool
  default = false
}

variable "twenty_image_uri" {
  type    = string
  default = ""
}

variable "twenty_db_username" {
  type    = string
  default = "thinkwork_twenty"
}

variable "twenty_db_name" {
  type    = string
  default = "thinkwork_twenty"
}

variable "twenty_db_url_secret_arn" {
  type    = string
  default = ""
}

variable "twenty_encryption_key_secret_arn" {
  type    = string
  default = ""
}

variable "twenty_email_from_address" {
  type    = string
  default = ""
}

variable "twenty_email_from_name" {
  type    = string
  default = "ThinkWork CRM"
}

variable "twenty_public_url" {
  type    = string
  default = ""
}

variable "twenty_certificate_arn" {
  type    = string
  default = ""
}

variable "agentcore_memory_id" {
  type        = string
  default     = ""
  description = "Optional pre-existing Bedrock AgentCore Memory resource ID. Leave empty to auto-provision."
}

variable "google_oauth_client_id" {
  type    = string
  default = ""
}

variable "google_oauth_client_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "pre_signup_lambda_zip" {
  type    = string
  default = ""
}

variable "cognito_custom_auth_lambda_zip" {
  type    = string
  default = ""
}

variable "lambda_zips_dir" {
  type    = string
  default = ""
}

variable "api_auth_secret" {
  type      = string
  sensitive = true
  default   = ""
}

variable "admin_callback_urls" {
  type    = list(string)
  default = ["http://localhost:5174", "http://localhost:5174/auth/callback"]
}

variable "admin_logout_urls" {
  type    = list(string)
  default = ["http://localhost:5174"]
}

variable "mobile_callback_urls" {
  type    = list(string)
  default = ["exp://localhost:8081", "thinkwork://", "thinkwork://auth/callback"]
}

variable "mobile_logout_urls" {
  type    = list(string)
  default = ["exp://localhost:8081", "thinkwork://"]
}

variable "memory_engine" {
  type    = string
  default = ""
}

variable "customer_domain" {
  type    = string
  default = ""
}

variable "customer_domain_delegated" {
  type    = bool
  default = false
}

variable "platform_operator_emails" {
  type    = list(string)
  default = []
}

variable "ses_parent_domain" {
  type    = string
  default = ""
}

variable "cognito_email_source_arn" {
  type    = string
  default = ""
}

variable "lambda_artifact_bucket" {
  type    = string
  default = ""
}

variable "lambda_artifact_prefix" {
  type    = string
  default = ""
}

variable "agentcore_pi_source_image_uri" {
  type    = string
  default = ""
}

module "thinkwork" {
  source = "./modules/thinkwork"

  providers = {
    aws.us_east_1 = aws.us_east_1
  }

  stage      = var.stage
  region     = var.region
  account_id = var.account_id

  memory_engine             = var.memory_engine
  customer_domain           = var.customer_domain
  customer_domain_delegated = var.customer_domain_delegated
  platform_operator_emails  = var.platform_operator_emails
  ses_parent_domain         = var.ses_parent_domain
  cognito_email_source_arn  = var.cognito_email_source_arn

  lambda_artifact_bucket        = var.lambda_artifact_bucket
  lambda_artifact_prefix        = var.lambda_artifact_prefix
  agentcore_pi_source_image_uri = var.agentcore_pi_source_image_uri

  db_password                = var.db_password
  database_engine            = var.database_engine
  enable_hindsight           = var.enable_hindsight
  enable_cognee              = var.enable_cognee
  cognee_image_uri           = var.cognee_image_uri
  cognee_db_username         = var.cognee_db_username
  cognee_db_name             = var.cognee_db_name
  cognee_db_password_secret_arn = var.cognee_db_password_secret_arn
  cognee_allowed_internal_cidr_blocks = var.cognee_allowed_internal_cidr_blocks
  cognee_allowed_internal_security_group_ids = var.cognee_allowed_internal_security_group_ids
  cognee_backend_mode = var.cognee_backend_mode
  cognee_desired_count = var.cognee_desired_count
  cognee_llm_provider = var.cognee_llm_provider
  cognee_llm_model = var.cognee_llm_model
  cognee_llm_api_key_secret_arn = var.cognee_llm_api_key_secret_arn
  cognee_embedding_provider = var.cognee_embedding_provider
  cognee_embedding_model = var.cognee_embedding_model
  cognee_embedding_dimensions = var.cognee_embedding_dimensions
  cognee_embedding_api_key_secret_arn = var.cognee_embedding_api_key_secret_arn
  cognee_vector_db_provider = var.cognee_vector_db_provider
  cognee_vector_db_url = var.cognee_vector_db_url
  cognee_vector_db_key_secret_arn = var.cognee_vector_db_key_secret_arn
  cognee_graph_database_provider = var.cognee_graph_database_provider
  cognee_graph_database_url = var.cognee_graph_database_url
  cognee_graph_database_username = var.cognee_graph_database_username
  cognee_graph_database_password_secret_arn = var.cognee_graph_database_password_secret_arn
  cognee_bedrock_model_resource_arns = var.cognee_bedrock_model_resource_arns
  cognee_kms_key_arns = var.cognee_kms_key_arns
  twenty_provisioned = var.twenty_provisioned
  twenty_runtime_enabled = var.twenty_runtime_enabled
  twenty_image_uri = var.twenty_image_uri
  twenty_db_username = var.twenty_db_username
  twenty_db_name = var.twenty_db_name
  twenty_db_url_secret_arn = var.twenty_db_url_secret_arn
  twenty_encryption_key_secret_arn = var.twenty_encryption_key_secret_arn
  twenty_email_from_address = var.twenty_email_from_address
  twenty_email_from_name = var.twenty_email_from_name
  twenty_public_url = var.twenty_public_url
  twenty_certificate_arn = var.twenty_certificate_arn
  agentcore_memory_id        = var.agentcore_memory_id
  google_oauth_client_id     = var.google_oauth_client_id
  google_oauth_client_secret = var.google_oauth_client_secret
  pre_signup_lambda_zip                = var.pre_signup_lambda_zip
  cognito_custom_auth_lambda_zip = var.cognito_custom_auth_lambda_zip
  lambda_zips_dir                      = var.lambda_zips_dir
  api_auth_secret                      = var.api_auth_secret
  admin_callback_urls                  = var.admin_callback_urls
  admin_logout_urls                    = var.admin_logout_urls
  mobile_callback_urls                 = var.mobile_callback_urls
  mobile_logout_urls                   = var.mobile_logout_urls
}

output "api_endpoint" {
  value = module.thinkwork.api_endpoint
}

output "app_bucket_name" {
  value = module.thinkwork.app_bucket_name
}

output "user_pool_id" {
  value = module.thinkwork.user_pool_id
}

output "admin_client_id" {
  value = module.thinkwork.admin_client_id
}

output "mobile_client_id" {
  value = module.thinkwork.mobile_client_id
}

output "bucket_name" {
  value = module.thinkwork.bucket_name
}

output "db_cluster_endpoint" {
  value = module.thinkwork.db_cluster_endpoint
}

output "db_secret_arn" {
  value     = module.thinkwork.db_secret_arn
  sensitive = true
}

output "ecr_repository_url" {
  value = module.thinkwork.ecr_repository_url
}

output "hindsight_enabled" {
  value = module.thinkwork.hindsight_enabled
}

output "hindsight_endpoint" {
  value = module.thinkwork.hindsight_endpoint
}

output "cognee_enabled" {
  value = module.thinkwork.cognee_enabled
}

output "cognee_endpoint" {
  value = module.thinkwork.cognee_endpoint
}

output "cognee_log_group_name" {
  value = module.thinkwork.cognee_log_group_name
}

output "twenty_provisioned" {
  value = module.thinkwork.twenty_provisioned
}

output "twenty_runtime_enabled" {
  value = module.thinkwork.twenty_runtime_enabled
}

output "twenty_url" {
  value = module.thinkwork.twenty_url
}

output "twenty_server_log_group_name" {
  value = module.thinkwork.twenty_server_log_group_name
}

output "twenty_worker_log_group_name" {
  value = module.thinkwork.twenty_worker_log_group_name
}

output "agentcore_memory_id" {
  value = module.thinkwork.agentcore_memory_id
}
`,
          );
        }

        console.log(`  Wrote ${chalk.cyan(tfDir + "/")}`);

        // ── Summary ────────────────────────────────────────────────────

        console.log("");
        console.log(chalk.dim("  ─────────────────────────────────────"));
        console.log(`  ${chalk.bold("Stage:")}           ${config.stage}`);
        console.log(`  ${chalk.bold("Region:")}          ${config.region}`);
        console.log(`  ${chalk.bold("Account:")}         ${config.account_id}`);
        console.log(
          `  ${chalk.bold("Database:")}        ${config.database_engine}`,
        );
        console.log(
          `  ${chalk.bold("Memory:")}          ${config.enable_hindsight === "true" ? "hindsight" : "agentcore managed"}`,
        );
        console.log(
          `  ${chalk.bold("Google OAuth:")}    ${config.google_oauth_client_id ? "enabled" : "disabled"}`,
        );
        console.log(`  ${chalk.bold("Directory:")}       ${tfDir}`);
        console.log(chalk.dim("  ─────────────────────────────────────"));

        // ── Terraform init ─────────────────────────────────────────────

        // ── State backend (R11): per-account bucket + lock table ────────
        let initArgs = "";
        try {
          const ensured = ensureStateBackend(
            config.account_id,
            config.region,
            config.stage,
          );
          initArgs = " " + backendConfigArgs(ensured.target).join(" ");
          console.log(
            `\n  State backend: s3://${ensured.target.bucket}/${ensured.target.key}` +
              (ensured.createdBucket ? " (bucket created)" : ""),
          );
        } catch (err) {
          printWarning(
            `Could not provision the Terraform state backend now (${(err as Error).message.split("\n")[0]}). ` +
              `\`thinkwork deploy -s ${stage}\` will provision it before applying.`,
          );
        }

        console.log("\n  Initializing Terraform...\n");
        try {
          execSync(`terraform init${initArgs}`, {
            cwd: tfDir,
            stdio: "inherit",
          });
        } catch {
          printWarning(
            "Terraform init failed. Run `thinkwork doctor -s " +
              stage +
              "` to check prerequisites.",
          );
          return;
        }

        // ── Save environment config ────────────────────────────────────

        const now = new Date().toISOString();
        saveEnvironment({
          stage: config.stage,
          region: config.region,
          accountId: config.account_id,
          terraformDir: tfDir,
          databaseEngine: config.database_engine,
          enableHindsight: config.enable_hindsight === "true",
          createdAt: now,
          updatedAt: now,
        });

        printSuccess(`Environment "${stage}" initialized`);
        console.log("");
        console.log("  Next steps:");
        console.log(
          `    ${chalk.cyan("1.")} thinkwork plan -s ${stage}        ${chalk.dim("# Review infrastructure plan")}`,
        );
        console.log(
          `    ${chalk.cyan("2.")} thinkwork deploy -s ${stage}       ${chalk.dim("# Deploy to AWS (~5 min)")}`,
        );
        console.log(
          `    ${chalk.cyan("3.")} thinkwork bootstrap -s ${stage}    ${chalk.dim("# Seed workspace files")}`,
        );
        console.log(
          `    ${chalk.cyan("4.")} thinkwork outputs -s ${stage}      ${chalk.dim("# Show API URL, Cognito IDs, etc.")}`,
        );
        console.log("");
      },
    );
}
