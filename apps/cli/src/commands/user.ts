/**
 * `thinkwork user ...` — user-management utilities for a deployed stack.
 *
 * Two surfaces today:
 *   - `invite`         — create a Cognito user + add them to a tenant. Supports
 *                         both fully-flagged (agent / script) and interactive
 *                         (TTY) invocations; when flags are missing in a TTY,
 *                         the CLI prompts via @inquirer/prompts.
 *   - `reset-password` — admin-initiated Cognito forgot-password.
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import { input, select } from "@inquirer/prompts";
import { validateStage } from "../config.js";
import { resolveTierDir, ensureInit, ensureWorkspace } from "../terraform.js";
import { apiFetch, apiFetchRaw, resolveApiConfig } from "../api-client.js";
import { listDeployedStages } from "../aws-discovery.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";
import { resolveStage } from "../lib/resolve-stage.js";
import { isCancellation } from "../lib/interactive.js";

/** Run `terraform output -raw <key>` and return stdout. */
function getTerraformOutput(cwd: string, key: string): Promise<string> {
  return new Promise((resolve, reject) => {
    const proc = spawn("terraform", ["output", "-raw", key], {
      cwd,
      stdio: ["pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => {
      if (code === 0) resolve(stdout.trim());
      else
        reject(
          new Error(
            `terraform output ${key} failed (exit ${code}): ${stderr.trim() || "no stderr"}`,
          ),
        );
    });
  });
}

/** Shell to `aws cognito-idp admin-reset-user-password`. Returns exit code. */
function runAwsCognitoReset(
  userPoolId: string,
  username: string,
  region: string | undefined,
): Promise<{ code: number; stdout: string; stderr: string }> {
  return new Promise((resolve) => {
    const args = [
      "cognito-idp",
      "admin-reset-user-password",
      "--user-pool-id",
      userPoolId,
      "--username",
      username,
      "--output",
      "json",
    ];
    if (region) args.push("--region", region);

    const proc = spawn("aws", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d));
    proc.stderr.on("data", (d) => (stderr += d));
    proc.on("close", (code) => resolve({ code: code ?? 1, stdout, stderr }));
  });
}

/**
 * Prompt for a value when running interactively; error clearly when not.
 * Returns null if the user cancels (Ctrl+C) — caller should short-circuit.
 */
function requireTty(label: string): void {
  if (!process.stdin.isTTY) {
    printError(
      `${label} is required. Pass it as a flag or re-run in an interactive terminal.`,
    );
    process.exit(1);
  }
}

async function promptEmail(): Promise<string> {
  requireTty("Email");
  return await input({
    message: "Email address of the person to invite:",
    validate: (v) =>
      v.trim().includes("@") ? true : "That doesn't look like an email.",
  });
}

async function promptStage(region: string): Promise<string> {
  requireTty("Stage");
  const stages = listDeployedStages(region);
  if (stages.length === 0) {
    printError(
      `No Thinkwork deployments found in ${region}. Run \`thinkwork list\` or pass --region.`,
    );
    process.exit(1);
  }
  if (stages.length === 1) {
    console.log(`  Using the only deployed stage: ${stages[0]}`);
    return stages[0];
  }
  return await select({
    message: "Which stage?",
    choices: stages.map((s) => ({ name: s, value: s })),
    loop: false,
  });
}

async function promptTenant(
  apiUrl: string,
  authSecret: string,
): Promise<string> {
  requireTty("Tenant");
  const list = (await apiFetch(apiUrl, authSecret, "/api/tenants")) as Array<{
    id: string;
    name: string;
    slug: string;
  }>;
  if (!list || list.length === 0) {
    printError(
      "No tenants exist in this stage yet. Create one in the admin UI first.",
    );
    process.exit(1);
  }
  if (list.length === 1) {
    console.log(`  Using the only tenant: ${list[0].name} (${list[0].slug})`);
    return list[0].slug;
  }
  return await select({
    message: "Which tenant?",
    choices: list.map((t) => ({
      name: `${t.name}  (slug: ${t.slug})`,
      value: t.slug,
    })),
    loop: false,
  });
}

async function promptOptionalName(): Promise<string | undefined> {
  // Only ask interactively; in non-TTY, skip silently.
  if (!process.stdin.isTTY) return undefined;
  const answer = await input({
    message: "Display name (optional, press Enter to skip):",
    default: "",
  });
  return answer.trim() || undefined;
}

async function promptRole(): Promise<string> {
  if (!process.stdin.isTTY) return "member";
  return await select({
    message: "Role:",
    choices: [
      { name: "member — regular access", value: "member" },
      { name: "admin — can manage members and settings", value: "admin" },
      { name: "owner — full control", value: "owner" },
    ],
    default: "member",
    loop: false,
  });
}

export function registerUserCommand(program: Command): void {
  const user = program
    .command("user")
    .description("User-management utilities for a deployed Thinkwork stack");

  user
    .command("invite [email]")
    .description(
      "Invite a teammate to a tenant. Creates the Cognito user (Cognito emails a temporary password) and adds them as a tenant member. Prompts interactively for any missing fields.",
    )
    .option("-s, --stage <name>", "Deployment stage (e.g. dev, prod)")
    .option(
      "--tenant <slug>",
      "Tenant slug (the URL-safe tenant id, e.g. acme)",
    )
    .option("--name <name>", "Display name for the invited user")
    .option(
      "--role <role>",
      'Tenant member role: "member", "admin", or "owner"',
    )
    .option("--region <region>", "AWS region to scan", "us-east-1")
    .addHelpText(
      "after",
      `
Examples:
  # Fully interactive — prompts for email, stage, tenant, name, role.
  $ thinkwork user invite

  # Scriptable (no prompts) — all fields via flags.
  $ thinkwork user invite alice@example.com --tenant acme -s dev

  # Mix: pass the email, prompt for everything else.
  $ thinkwork user invite alice@example.com

  # With display name and admin role.
  $ thinkwork user invite bob@example.com --tenant acme -s dev \\
      --name "Bob Smith" --role admin

What happens:
  1. A Cognito user is created (or reused if the email already exists).
  2. Cognito emails the user a temporary password.
  3. The user is added to the tenant with the given role.
  4. On first sign-in they're prompted to set a real password.

Re-inviting someone who's already a member is a no-op (no second email).
Agents / scripts that pass all flags stay non-interactive.
`,
    )
    .action(
      async (
        emailArg: string | undefined,
        opts: {
          stage?: string;
          tenant?: string;
          name?: string;
          role?: string;
          region: string;
        },
      ): Promise<void> => {
        try {
          // Resolve email
          let email = emailArg ?? "";
          if (!email) email = await promptEmail();
          email = email.trim().toLowerCase();
          if (!email.includes("@")) {
            printError(
              `"${emailArg}" doesn't look like an email address. Pass the user's sign-in email.`,
            );
            process.exit(1);
          }

          // Resolve stage
          let stage = opts.stage;
          if (!stage) stage = await promptStage(opts.region);
          const stageCheck = validateStage(stage);
          if (!stageCheck.valid) {
            printError(stageCheck.error!);
            process.exit(1);
          }

          // Resolve API config (tfvars or Lambda-env fallback)
          const api = resolveApiConfig(stage, opts.region);
          if (!api) process.exit(1);

          // Resolve tenant
          let tenant = opts.tenant;
          if (!tenant) tenant = await promptTenant(api!.apiUrl, api!.authSecret);

          // Optional fields
          let name = opts.name;
          if (name === undefined && !emailArg) name = await promptOptionalName();
          let role = opts.role;
          if (!role && !emailArg) role = await promptRole();
          role = role || "member";

          printHeader("user invite", stage);
          console.log(`  Tenant: ${tenant}`);
          console.log(`  Email:  ${email}`);
          if (name) console.log(`  Name:   ${name}`);
          console.log(`  Role:   ${role}`);
          console.log("");

          const result = await apiFetchRaw<{
            alreadyMember?: boolean;
            error?: string;
            role?: string;
          }>(
            api!.apiUrl,
            api!.authSecret,
            `/api/tenants/${encodeURIComponent(tenant)}/invites`,
            {
              method: "POST",
              body: JSON.stringify({
                email,
                name: name ?? null,
                role,
              }),
            },
          );

          if (!result.ok) {
            const msg =
              (result.body as any)?.error || `HTTP ${result.status}`;
            printError(`Invite failed: ${msg}`);
            process.exit(1);
          }

          if (result.body.alreadyMember) {
            printWarning(
              `${email} is already a member of "${tenant}" (role: ${result.body.role}). No email sent.`,
            );
            return;
          }

          printSuccess(
            `Invited ${email} to "${tenant}" (role: ${result.body.role}). Cognito has emailed a temporary password; the user sets a new password on first sign-in.`,
          );
        } catch (err: any) {
          if (isCancellation(err)) {
            console.log("");
            console.log("  Cancelled.");
            return;
          }
          printError(
            `Invite failed: ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }
      },
    );

  user
    .command("reset-password <email>")
    .description(
      "Trigger Cognito's forgot-password flow for a user (admin-initiated). Prompts for stage in a TTY when omitted.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .option("-s, --stage <name>", "Deployment stage (e.g. dev, prod)")
    .option(
      "-r, --region <name>",
      "AWS region (defaults to AWS CLI default / AWS_REGION)",
    )
    .addHelpText(
      "after",
      `
Examples:
  # Fully interactive — picks stage from the deployed ones
  $ thinkwork user reset-password alice@example.com

  # Scripted
  $ thinkwork user reset-password alice@example.com -s dev

  # Target a specific AWS profile + region
  $ thinkwork user reset-password alice@example.com -s prod \\
      --profile thinkwork --region us-east-1

Cognito emails the user a verification code; they set a new password on
next sign-in. Use this instead of \`forgot-password\` when the user is in
FORCE_CHANGE_PASSWORD or has been disabled.
`,
    )
    .action(
      async (
        email: string,
        opts: { stage?: string; region?: string },
      ): Promise<void> => {
        let stage: string;
        try {
          stage = await resolveStage({ flag: opts.stage, region: opts.region });
        } catch (err) {
          if (isCancellation(err)) return;
          throw err;
        }

        if (!email || !email.includes("@")) {
          printError(
            `"${email}" doesn't look like an email address. Pass the user's sign-in email.`,
          );
          process.exit(1);
        }

        printHeader("user reset-password", stage);

        const terraformDir =
          process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
        const cwd = resolveTierDir(terraformDir, stage, "app");
        await ensureInit(cwd);
        await ensureWorkspace(cwd, stage);

        let userPoolId: string;
        try {
          userPoolId = await getTerraformOutput(cwd, "user_pool_id");
        } catch (err) {
          printError(
            `Failed to read user_pool_id from Terraform outputs. Is the stack deployed? ${err instanceof Error ? err.message : String(err)}`,
          );
          process.exit(1);
        }

        if (!userPoolId) {
          printError(
            "user_pool_id output is empty — the stack may not be fully deployed.",
          );
          process.exit(1);
        }

        console.log(`  User pool: ${userPoolId}`);
        console.log(`  Email:     ${email}`);
        console.log("");

        const result = await runAwsCognitoReset(userPoolId, email, opts.region);

        if (result.code === 0) {
          printSuccess(
            `Reset triggered for ${email}. Cognito has emailed a verification code; the user sets a new password on next sign-in.`,
          );
          return;
        }

        // Surface Cognito's error as-is so the operator can act.
        if (result.stderr.includes("UserNotFoundException")) {
          printError(
            `No user found with email ${email} in pool ${userPoolId}. Check the address (case-insensitive) or that they've signed up.`,
          );
        } else if (result.stderr.includes("NotAuthorizedException")) {
          printError(
            "Cognito rejected the call — your AWS credentials may not have cognito-idp:AdminResetUserPassword on this pool.",
          );
        } else {
          printError(
            `admin-reset-user-password failed (exit ${result.code}): ${result.stderr.trim() || "no stderr"}`,
          );
        }
        process.exit(result.code);
      },
    );
}
