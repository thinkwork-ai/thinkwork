import { execFileSync } from "node:child_process";

export type EnterpriseToolName = "git" | "gh";

export interface EnterpriseToolCheck {
  name: EnterpriseToolName;
  ok: boolean;
  message: string;
  remediation?: string;
}

export interface EnterprisePreflightResult {
  git: EnterpriseToolCheck;
  github: EnterpriseToolCheck & {
    authenticated: boolean;
  };
  ready: boolean;
}

export interface EnterprisePreflightRunner {
  execFileSync: typeof execFileSync;
}

export function checkEnterpriseDeployReadiness(
  runner: EnterprisePreflightRunner = { execFileSync },
): EnterprisePreflightResult {
  const git = checkExecutable("git", ["--version"], runner);
  const gh = checkExecutable("gh", ["--version"], runner);

  if (!gh.ok) {
    const github = {
      ...gh,
      authenticated: false,
    };
    return {
      git,
      github,
      ready: git.ok && github.ok && github.authenticated,
    };
  }

  const authenticated = checkGitHubAuthentication(runner);
  const github = authenticated
    ? {
        name: "gh" as const,
        ok: true,
        authenticated: true,
        message: "GitHub CLI is authenticated.",
      }
    : {
        name: "gh" as const,
        ok: true,
        authenticated: false,
        message: "GitHub CLI is installed but not authenticated.",
        remediation: "Run `gh auth login` before enterprise deploy.",
      };

  return {
    git,
    github,
    ready: git.ok && github.authenticated,
  };
}

export function runGitHubLogin(
  runner: EnterprisePreflightRunner = { execFileSync },
): void {
  runner.execFileSync("gh", ["auth", "login"], { stdio: "inherit" });
}

function checkExecutable(
  command: EnterpriseToolName,
  args: string[],
  runner: EnterprisePreflightRunner,
): EnterpriseToolCheck {
  try {
    runner.execFileSync(command, args, {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return {
      name: command,
      ok: true,
      message: `${command} is installed.`,
    };
  } catch (err) {
    return {
      name: command,
      ok: false,
      message: `${command} is not available on PATH.`,
      remediation: remediationFor(command, err),
    };
  }
}

function checkGitHubAuthentication(runner: EnterprisePreflightRunner): boolean {
  try {
    runner.execFileSync("gh", ["auth", "status"], {
      encoding: "utf-8",
      stdio: ["ignore", "pipe", "pipe"],
    });
    return true;
  } catch {
    return false;
  }
}

function remediationFor(command: EnterpriseToolName, err: unknown): string {
  const missing =
    err &&
    typeof err === "object" &&
    "code" in err &&
    (err as { code?: unknown }).code === "ENOENT";

  if (command === "gh") {
    return missing
      ? "Install GitHub CLI, then run `gh auth login`."
      : "Verify GitHub CLI with `gh auth status`.";
  }

  return missing ? "Install git before enterprise deploy." : "Verify git.";
}
