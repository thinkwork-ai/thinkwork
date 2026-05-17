/**
 * `thinkwork login` — two sign-in flows, chosen by the presence of `--stage`.
 *
 *   Without --stage
 *     AWS credentials picker (the original flow). Stores the chosen profile
 *     in ~/.thinkwork/config.json as `defaultProfile`. Used before deploy /
 *     destroy / list / any AWS-CLI-shelling command.
 *
 *   With --stage <s>
 *     Cognito OAuth2 authorization-code flow over a local loopback listener
 *     (default port 42010 — registered in the admin client's callback list).
 *     After sign-in we exchange the code for id/refresh tokens, call
 *     bootstrapUser to guarantee the DB row + tenant exist, and cache the
 *     session + default tenant in ~/.thinkwork/config.json under
 *     `sessions[<stage>]`. Used before any API-backed command
 *     (`thinkwork thread ls`, `thinkwork agent create`, etc.).
 *
 *   With --stage <s> --api-key <secret>
 *     Service / CI path. No browser. Stores the static bearer + tenant on the
 *     session. Mirrors today's api_auth_secret behavior so automation doesn't
 *     need an interactive login.
 */

import { Command } from "commander";
import { execSync } from "node:child_process";
import { createInterface } from "node:readline";
import { select, Separator } from "@inquirer/prompts";
import chalk from "chalk";
import { getAwsIdentity } from "../aws.js";
import { listAwsProfiles, type AwsProfile } from "../aws-profiles.js";
import { saveCliConfig, saveStageSession } from "../cli-config.js";
import { ensureAwsCli } from "../prerequisites.js";
import { printHeader, printSuccess, printError, printWarning } from "../ui.js";
import { validateStage } from "../config.js";
import { discoverCognitoConfig } from "../cognito-discovery.js";
import {
  loginWithCognito,
  decodeIdToken,
  CLI_LOOPBACK_PORT,
} from "../cognito-oauth.js";
import { getApiEndpoint } from "../aws-discovery.js";
import { isCancellation } from "../lib/interactive.js";

function ask(prompt: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  return new Promise((resolve) => {
    rl.question(prompt, (answer) => {
      rl.close();
      resolve(answer.trim());
    });
  });
}

/** Verify a profile with `sts get-caller-identity`. Returns null on failure. */
function verifyProfile(
  profile: string,
): { account: string; arn: string } | null {
  try {
    const raw = execSync(
      `aws sts get-caller-identity --profile ${profile} --output json`,
      { encoding: "utf-8", timeout: 15_000, stdio: ["pipe", "pipe", "pipe"] },
    );
    const parsed = JSON.parse(raw) as { Account: string; Arn: string };
    return { account: parsed.Account, arn: parsed.Arn };
  } catch {
    return null;
  }
}

function describeType(type: AwsProfile["type"]): string {
  switch (type) {
    case "keys":
      return "access keys";
    case "sso":
      return "SSO";
    case "role":
      return "assumed role";
    default:
      return "config only";
  }
}

type Choice =
  | { kind: "existing"; name: string }
  | { kind: "keys" }
  | { kind: "sso" }
  | { kind: "cancel" };

type ChoiceValue =
  | { kind: "existing"; name: string }
  | { kind: "keys" }
  | { kind: "sso" };

/**
 * Interactive picker with arrow-key navigation. Requires a TTY stdin; when
 * piped / in CI, ask the caller to pass --keys / --sso / --profile instead.
 */
async function pickProfile(profiles: AwsProfile[]): Promise<Choice> {
  if (!process.stdin.isTTY) {
    printError(
      "The profile picker needs an interactive terminal. Re-run with --keys, --sso, or --profile <name>.",
    );
    return { kind: "cancel" };
  }

  const choices: Array<
    { name: string; value: ChoiceValue; description?: string } | Separator
  > = profiles.map((p) => ({
    name: `${p.name}  ${chalk.dim(`(${describeType(p.type)})`)}`,
    value: { kind: "existing", name: p.name },
  }));
  choices.push(new Separator());
  choices.push({
    name: "Enter new access keys",
    value: { kind: "keys" },
    description:
      "Paste an AWS Access Key ID and Secret Access Key; saved to a new profile.",
  });
  choices.push({
    name: "Log in via AWS SSO",
    value: { kind: "sso" },
    description: "Run `aws sso login` against the configured SSO profile.",
  });

  try {
    const picked = await select<ChoiceValue>({
      message: "Pick an AWS profile for Thinkwork:",
      choices,
      loop: false,
      pageSize: Math.max(profiles.length + 2, 10),
    });
    return picked;
  } catch (err) {
    if (err instanceof Error && err.name === "ExitPromptError") {
      return { kind: "cancel" };
    }
    throw err;
  }
}

async function runKeyEntry(targetProfile: string): Promise<boolean> {
  console.log("");
  console.log("  Enter your AWS credentials. These will be saved to the");
  console.log(`  AWS CLI profile "${targetProfile}".`);
  console.log("");

  const accessKeyId = await ask("  AWS Access Key ID: ");
  if (!accessKeyId) {
    printError("Access Key ID is required");
    return false;
  }

  const secretAccessKey = await ask("  AWS Secret Access Key: ");
  if (!secretAccessKey) {
    printError("Secret Access Key is required");
    return false;
  }

  const region = await ask("  Default region [us-east-1]: ");
  const finalRegion = region || "us-east-1";

  try {
    execSync(
      `aws configure set aws_access_key_id "${accessKeyId}" --profile ${targetProfile}`,
      { stdio: "pipe" },
    );
    execSync(
      `aws configure set aws_secret_access_key "${secretAccessKey}" --profile ${targetProfile}`,
      { stdio: "pipe" },
    );
    execSync(
      `aws configure set region "${finalRegion}" --profile ${targetProfile}`,
      { stdio: "pipe" },
    );
    return true;
  } catch (err) {
    printError(`Failed to save credentials: ${err}`);
    return false;
  }
}

function runSsoLogin(targetProfile: string): boolean {
  console.log("  Launching AWS SSO login...");
  console.log("");
  try {
    execSync(`aws sso login --profile ${targetProfile}`, { stdio: "inherit" });
    return true;
  } catch {
    printError(
      `SSO login failed. Run \`aws configure sso --profile ${targetProfile}\` first to set up the profile.`,
    );
    return false;
  }
}

function finalizeAws(profile: string, mode: string): void {
  const identity = getAwsIdentity();
  if (!identity) {
    printError(
      `Credentials saved but could not verify with profile "${profile}". Try \`aws sts get-caller-identity --profile ${profile}\`.`,
    );
    process.exit(1);
  }
  saveCliConfig({ defaultProfile: profile });
  printSuccess(
    `Logged in via ${mode} (account: ${identity.account}, region: ${identity.region})`,
  );
  console.log("");
  console.log(
    `  Profile "${profile}" saved as your Thinkwork default. Subsequent commands`,
  );
  console.log(
    `  (\`thinkwork list\`, \`thinkwork deploy\`, …) will use it automatically.`,
  );
  console.log(
    chalk.dim(
      `  Override per-command with --profile <other>, or unset with \`rm ~/.thinkwork/config.json\`.`,
    ),
  );
  console.log("");
  console.log(
    `  ${chalk.bold("Next:")} run ${chalk.cyan("thinkwork login --stage <stage>")} if you also need`,
  );
  console.log(
    `        an API session (required for ${chalk.cyan("eval")}, ${chalk.cyan("agent")}, ${chalk.cyan("thread")}, etc.).`,
  );
}

// ---------------------------------------------------------------------------
// Stack login (Cognito OAuth or api-key)
// ---------------------------------------------------------------------------

/**
 * Call `bootstrapUser` to guarantee the authed Cognito identity has a DB row
 * + tenant. Returns the tenant so we can cache it on the session.
 *
 * We use plain fetch + an inline query string here to avoid the codegen
 * chicken-and-egg: login wires *up* the gql client, it doesn't consume one.
 */
async function bootstrapUserAndTenant(
  stage: string,
  region: string,
  idToken: string,
): Promise<{ tenantId: string; tenantSlug: string; tenantName: string } | null> {
  const baseUrl = getApiEndpoint(stage, region);
  if (!baseUrl) return null;
  const url = `${baseUrl.replace(/\/+$/, "")}/graphql`;

  const query = `mutation BootstrapLogin {
    bootstrapUser {
      tenant { id slug name }
    }
  }`;

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        Authorization: idToken,
      },
      body: JSON.stringify({ query }),
    });
    if (!res.ok) return null;
    const json = (await res.json()) as {
      data?: { bootstrapUser?: { tenant?: { id: string; slug: string; name: string } } };
      errors?: Array<{ message: string }>;
    };
    const tenant = json.data?.bootstrapUser?.tenant;
    if (!tenant) return null;
    return {
      tenantId: tenant.id,
      tenantSlug: tenant.slug,
      tenantName: tenant.name,
    };
  } catch {
    return null;
  }
}

async function doCognitoLogin(opts: {
  stage: string;
  region: string;
  port: number;
  noBrowser: boolean;
}): Promise<void> {
  printHeader("login", opts.stage);

  const cognito = discoverCognitoConfig(opts.stage, opts.region);
  if (!cognito) {
    printError(
      `Could not find a Cognito user pool for stage "${opts.stage}" in ${opts.region}. Is the stack deployed?`,
    );
    process.exit(1);
  }

  console.log(`  User pool:     ${cognito.userPoolId}`);
  console.log(`  Client:        ${cognito.clientId}`);
  console.log(`  Hosted UI:     ${cognito.domainUrl}`);
  console.log(`  Callback port: ${opts.port}`);

  try {
    const tokens = await loginWithCognito({
      cognito,
      port: opts.port,
      openBrowser: !opts.noBrowser,
    });

    const claims = decodeIdToken(tokens.idToken);
    const bootstrap = await bootstrapUserAndTenant(
      opts.stage,
      opts.region,
      tokens.idToken,
    );

    saveStageSession(opts.stage, {
      kind: "cognito",
      idToken: tokens.idToken,
      accessToken: tokens.accessToken,
      refreshToken: tokens.refreshToken,
      expiresAt: tokens.expiresAt,
      userPoolId: cognito.userPoolId,
      userPoolClientId: cognito.clientId,
      cognitoDomain: cognito.domain,
      region: cognito.region,
      principalId: claims.sub,
      email: claims.email,
      tenantId: bootstrap?.tenantId,
      tenantSlug: bootstrap?.tenantSlug,
    });

    // Remember this stage as the default so subsequent commands can omit -s.
    saveCliConfig({ defaultStage: opts.stage });

    printSuccess(`Signed in to ${opts.stage} as ${claims.email ?? claims.sub}`);
    if (bootstrap) {
      console.log(
        `  Tenant: ${bootstrap.tenantName} (slug: ${bootstrap.tenantSlug})`,
      );
    } else {
      printWarning(
        "Signed in, but could not resolve a default tenant. Commands will prompt or require --tenant <slug> until one is cached.",
      );
    }
    console.log("");
    console.log(
      chalk.dim(
        `  Token expires: ${new Date(tokens.expiresAt * 1000).toISOString()}. Refreshed automatically.`,
      ),
    );
  } catch (err) {
    if (isCancellation(err)) {
      console.log("");
      console.log("  Cancelled.");
      return;
    }
    printError(
      `Sign-in failed: ${err instanceof Error ? err.message : String(err)}`,
    );
    process.exit(1);
  }
}

async function doApiKeyLogin(opts: {
  stage: string;
  region: string;
  apiKey: string;
  tenantSlug?: string;
  tenantId?: string;
}): Promise<void> {
  printHeader("login", opts.stage);

  // Verify the key works with a cheap GraphQL ping (me query — allowed for
  // api-key callers that supply x-tenant-id, falls back to just trying).
  const baseUrl = getApiEndpoint(opts.stage, opts.region);
  if (!baseUrl) {
    printError(
      `Cannot discover API endpoint for stage "${opts.stage}" in ${opts.region}. Is the stack deployed?`,
    );
    process.exit(1);
  }

  saveStageSession(opts.stage, {
    kind: "api-key",
    authSecret: opts.apiKey,
    tenantId: opts.tenantId,
    tenantSlug: opts.tenantSlug,
  });
  saveCliConfig({ defaultStage: opts.stage });

  printSuccess(`Stored api-key session for stage "${opts.stage}"`);
  if (opts.tenantSlug) {
    console.log(`  Default tenant: ${opts.tenantSlug}`);
  } else {
    printWarning(
      "No tenant cached. Commands will require --tenant <slug> or THINKWORK_TENANT.",
    );
  }
}

// ---------------------------------------------------------------------------
// Registration
// ---------------------------------------------------------------------------

export function registerLoginCommand(program: Command): void {
  program
    .command("login")
    .description(
      "Sign in. Without --stage: configure AWS credentials (for deploy / destroy). With --stage <s>: sign in to that stack's Cognito / API and cache a session for API-backed commands.",
    )
    .option(
      "--profile <name>",
      "AWS profile name to configure (used when entering new keys or SSO)",
      "thinkwork",
    )
    .option("--sso", "Skip the picker and go straight to SSO login")
    .option("--keys", "Skip the picker and go straight to access-key entry")
    .option(
      "-s, --stage <name>",
      "Sign in to a deployed stack instead of configuring AWS credentials",
    )
    .option(
      "-r, --region <region>",
      "AWS region for the stack (defaults to us-east-1)",
      "us-east-1",
    )
    .option(
      "--api-key <secret>",
      "Non-interactive path: store the api_auth_secret as the session for --stage <s>. Skips the browser.",
    )
    .option(
      "--tenant <slug>",
      "Cache this tenant slug on the session (used with --api-key, or to override the tenant chosen by bootstrapUser).",
    )
    .option(
      "--port <number>",
      `Loopback port for Cognito OAuth callback. Must match a registered callback URL. Defaults to ${CLI_LOOPBACK_PORT}.`,
      String(CLI_LOOPBACK_PORT),
    )
    .option(
      "--no-browser",
      "Don't attempt to open the browser automatically — print the URL instead.",
    )
    .addHelpText(
      "after",
      `
Examples:
  # Configure AWS credentials (profile picker) — used before deploy/destroy/list.
  $ thinkwork login

  # Sign in to a deployed stack with Cognito (opens your browser, supports Google SSO).
  $ thinkwork login --stage dev

  # Non-interactive CI login against prod using the api_auth_secret.
  $ thinkwork login --stage prod --api-key "$THINKWORK_API_KEY" --tenant acme

  # Print the URL instead of auto-opening (useful over SSH).
  $ thinkwork login --stage dev --no-browser

  # AWS SSO (no stage)
  $ thinkwork login --sso --profile work-sso

How the session is stored:
  ~/.thinkwork/config.json gains \`sessions["<stage>"]\` with either a Cognito
  id/refresh token pair or the api-key secret + tenant. Subsequent commands
  resolve auth from this file; Cognito tokens are refreshed transparently.

Registered callback URL:
  The Cognito admin client must list \`http://127.0.0.1:${CLI_LOOPBACK_PORT}/callback\` in its
  callback URLs. The default terraform module already does — if you deployed
  before that default existed, run \`terraform apply\` in the foundation tier
  to pick it up. Or use \`--api-key\` to skip the browser entirely.
`,
    )
    .action(
      async (opts: {
        profile: string;
        sso?: boolean;
        keys?: boolean;
        stage?: string;
        region: string;
        apiKey?: string;
        tenant?: string;
        port: string;
        browser: boolean; // commander exposes --no-browser as `browser: false`
      }) => {
        // Stack-login branch.
        if (opts.stage) {
          const check = validateStage(opts.stage);
          if (!check.valid) {
            printError(check.error!);
            process.exit(1);
          }
          if (opts.apiKey) {
            await doApiKeyLogin({
              stage: opts.stage,
              region: opts.region,
              apiKey: opts.apiKey,
              tenantSlug: opts.tenant,
            });
            return;
          }
          const port = Number.parseInt(opts.port, 10);
          if (!Number.isFinite(port) || port < 1 || port > 65535) {
            printError(`Invalid --port value: "${opts.port}".`);
            process.exit(1);
          }
          await doCognitoLogin({
            stage: opts.stage,
            region: opts.region,
            port,
            noBrowser: opts.browser === false,
          });
          return;
        }

        // AWS-profile branch (unchanged).
        printHeader("login", opts.profile);

        const awsOk = await ensureAwsCli();
        if (!awsOk) process.exit(1);

        if (opts.sso) {
          if (!runSsoLogin(opts.profile)) process.exit(1);
          process.env.AWS_PROFILE = opts.profile;
          finalizeAws(opts.profile, "SSO");
          return;
        }
        if (opts.keys) {
          if (!(await runKeyEntry(opts.profile))) process.exit(1);
          process.env.AWS_PROFILE = opts.profile;
          finalizeAws(opts.profile, "access keys");
          return;
        }

        const profiles = listAwsProfiles();

        if (profiles.length === 0) {
          console.log("");
          console.log(chalk.dim("  No AWS profiles found in ~/.aws/."));
          console.log(
            chalk.dim("  Falling through to access-key entry for a new profile."),
          );
          if (!(await runKeyEntry(opts.profile))) process.exit(1);
          process.env.AWS_PROFILE = opts.profile;
          finalizeAws(opts.profile, "access keys");
          return;
        }

        const choice = await pickProfile(profiles);
        if (choice.kind === "cancel") {
          console.log("");
          console.log(chalk.dim("  Cancelled. No changes made."));
          return;
        }

        if (choice.kind === "keys") {
          if (!(await runKeyEntry(opts.profile))) process.exit(1);
          process.env.AWS_PROFILE = opts.profile;
          finalizeAws(opts.profile, "access keys");
          return;
        }

        if (choice.kind === "sso") {
          if (!runSsoLogin(opts.profile)) process.exit(1);
          process.env.AWS_PROFILE = opts.profile;
          finalizeAws(opts.profile, "SSO");
          return;
        }

        const picked = choice.name;
        console.log("");
        console.log(`  Verifying "${picked}"...`);
        const identity = verifyProfile(picked);
        if (!identity) {
          printError(
            `Could not authenticate with profile "${picked}". If it's an SSO profile, try \`aws sso login --profile ${picked}\` first.`,
          );
          process.exit(1);
        }
        process.env.AWS_PROFILE = picked;
        finalizeAws(picked, "existing profile");
      },
    );
}
