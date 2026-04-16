/**
 * `thinkwork user ...` — user-management utilities for a deployed stack.
 *
 * Ops surface only: today the sole command is `reset-password`, which
 * triggers Cognito's forgot-password flow for a given email. The user
 * pool is read from the deployed Terraform outputs (same pattern the
 * `bootstrap` command uses), so there's no stack identifier to pass
 * beyond `--stage`.
 *
 * Admin-triggered vs. user-initiated: we use
 * `admin-reset-user-password` because it works even when the user's
 * account is in `FORCE_CHANGE_PASSWORD` or a disabled-due-to-forgotten
 * state — situations that block `forgot-password`. On success Cognito
 * emails the user a verification code; they set a new password in the
 * app the next time they sign in.
 *
 * This shells to the AWS CLI (same choice `bootstrap` made) to avoid
 * adding `@aws-sdk/client-cognito-identity-provider` to the CLI
 * bundle. The tradeoff: requires the `aws` binary on PATH, which the
 * `doctor` command already verifies.
 */

import { Command } from "commander";
import { spawn } from "node:child_process";
import { validateStage } from "../config.js";
import { resolveTierDir, ensureInit, ensureWorkspace } from "../terraform.js";
import { apiFetchRaw, resolveApiConfig } from "../api-client.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";

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

export function registerUserCommand(program: Command): void {
  const user = program
    .command("user")
    .description("User-management utilities for a deployed Thinkwork stack");

  user
    .command("invite <email>")
    .description(
      "Invite a teammate to a tenant. Creates the Cognito user (Cognito emails a temporary password) and adds them as a tenant member.",
    )
    .requiredOption("-s, --stage <name>", "Deployment stage (e.g. dev, prod)")
    .requiredOption(
      "--tenant <slug>",
      "Tenant slug (the URL-safe tenant id, e.g. acme)",
    )
    .option("--name <name>", "Display name for the invited user")
    .option(
      "--role <role>",
      'Tenant member role: "member", "admin", or "owner"',
      "member",
    )
    .addHelpText(
      "after",
      `
Examples:
  # Invite a teammate as a regular member
  $ thinkwork user invite alice@example.com --tenant acme -s dev

  # Invite with a display name and admin role
  $ thinkwork user invite bob@example.com --tenant acme -s dev \\
      --name "Bob Smith" --role admin

  # Re-inviting someone who's already a member is a no-op (no second email)
  $ thinkwork user invite alice@example.com --tenant acme -s dev
  ⚠  alice@example.com is already a member of "acme" (role: member). No email sent.

What happens:
  1. A Cognito user is created (or reused if the email already exists).
  2. Cognito emails the user a temporary password.
  3. The user is added to the tenant with the given role.
  4. On first sign-in they're prompted to set a real password.

Requires the stack to be deployed (the CLI discovers the API Gateway URL
and reads api_auth_secret from terraform.tfvars for the stage).
`,
    )
    .action(
      async (
        email: string,
        opts: {
          stage: string;
          tenant: string;
          name?: string;
          role: string;
        },
      ): Promise<void> => {
        const stageCheck = validateStage(opts.stage);
        if (!stageCheck.valid) {
          printError(stageCheck.error!);
          process.exit(1);
        }

        const trimmed = email.trim().toLowerCase();
        if (!trimmed || !trimmed.includes("@")) {
          printError(
            `"${email}" doesn't look like an email address. Pass the user's sign-in email.`,
          );
          process.exit(1);
        }

        const api = resolveApiConfig(opts.stage);
        if (!api) process.exit(1);

        printHeader("user invite", opts.stage);
        console.log(`  Tenant: ${opts.tenant}`);
        console.log(`  Email:  ${trimmed}`);
        if (opts.name) console.log(`  Name:   ${opts.name}`);
        console.log(`  Role:   ${opts.role}`);
        console.log("");

        try {
          const result = await apiFetchRaw<{
            alreadyMember?: boolean;
            error?: string;
            role?: string;
          }>(
            api!.apiUrl,
            api!.authSecret,
            `/api/tenants/${encodeURIComponent(opts.tenant)}/members`,
            {
              method: "POST",
              body: JSON.stringify({
                email: trimmed,
                name: opts.name ?? null,
                role: opts.role,
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
              `${trimmed} is already a member of "${opts.tenant}" (role: ${result.body.role}). No email sent.`,
            );
            return;
          }

          printSuccess(
            `Invited ${trimmed} to "${opts.tenant}" (role: ${result.body.role}). Cognito has emailed a temporary password; the user sets a new password on first sign-in.`,
          );
        } catch (err: any) {
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
      "Trigger Cognito's forgot-password flow for a user (admin-initiated). Sends them a verification code email.",
    )
    .option("-p, --profile <name>", "AWS profile")
    .requiredOption("-s, --stage <name>", "Deployment stage (e.g. dev, prod)")
    .option(
      "-r, --region <name>",
      "AWS region (defaults to AWS CLI default / AWS_REGION)",
    )
    .addHelpText(
      "after",
      `
Examples:
  # Admin-triggered password reset — works even if the account is locked
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
        opts: { stage: string; region?: string },
      ): Promise<void> => {
        const stageCheck = validateStage(opts.stage);
        if (!stageCheck.valid) {
          printError(stageCheck.error!);
          process.exit(1);
        }

        if (!email || !email.includes("@")) {
          printError(
            `"${email}" doesn't look like an email address. Pass the user's sign-in email.`,
          );
          process.exit(1);
        }

        printHeader("user reset-password", opts.stage);

        const terraformDir =
          process.env.THINKWORK_TERRAFORM_DIR || process.cwd();
        const cwd = resolveTierDir(terraformDir, opts.stage, "app");
        await ensureInit(cwd);
        await ensureWorkspace(cwd, opts.stage);

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
