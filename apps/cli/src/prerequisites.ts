/**
 * Auto-install prerequisites (AWS CLI, Terraform) if missing.
 * Makes `thinkwork init` work with zero pre-setup — just bring your AWS keys.
 */

import { execSync } from "node:child_process";
import { existsSync, mkdirSync, createWriteStream, chmodSync } from "node:fs";
import { join } from "node:path";
import { homedir, platform, arch } from "node:os";
import chalk from "chalk";

function run(cmd: string, opts?: { silent?: boolean }): string | null {
  try {
    return execSync(cmd, {
      encoding: "utf-8",
      timeout: 30_000,
      stdio: opts?.silent ? ["pipe", "pipe", "pipe"] : undefined,
    }).trim();
  } catch {
    return null;
  }
}

function isInstalled(cmd: string): boolean {
  return run(`which ${cmd}`, { silent: true }) !== null;
}

function hasBrew(): boolean {
  return isInstalled("brew");
}

async function downloadFile(url: string, dest: string): Promise<void> {
  const { default: https } = await import("node:https");
  const { default: http } = await import("node:http");
  const mod = url.startsWith("https") ? https : http;

  return new Promise((resolve, reject) => {
    const follow = (url: string) => {
      mod.get(url, (res) => {
        if (res.statusCode === 301 || res.statusCode === 302) {
          follow(res.headers.location!);
          return;
        }
        if (res.statusCode !== 200) {
          reject(new Error(`Download failed: ${res.statusCode}`));
          return;
        }
        const file = createWriteStream(dest);
        res.pipe(file);
        file.on("finish", () => { file.close(); resolve(); });
        file.on("error", reject);
      }).on("error", reject);
    };
    follow(url);
  });
}

export async function ensureAwsCli(): Promise<boolean> {
  if (isInstalled("aws")) return true;

  console.log(`  ${chalk.yellow("→")} AWS CLI not found. Installing...`);

  const os = platform();

  if (os === "darwin" && hasBrew()) {
    const result = run("brew install awscli");
    if (result !== null && isInstalled("aws")) {
      console.log(`  ${chalk.green("✓")} AWS CLI installed via Homebrew`);
      return true;
    }
  }

  if (os === "linux") {
    try {
      const tmpDir = join(homedir(), ".thinkwork", "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const zipPath = join(tmpDir, "awscliv2.zip");
      console.log("    Downloading AWS CLI...");
      run(`curl -sL "https://awscli.amazonaws.com/awscli-exe-linux-x86_64.zip" -o "${zipPath}"`);
      run(`cd "${tmpDir}" && unzip -qo "${zipPath}"`);
      run(`"${tmpDir}/aws/install" --install-dir "${homedir()}/.thinkwork/aws-cli" --bin-dir "${homedir()}/.local/bin" --update`);
      // Add to PATH for this session
      process.env.PATH = `${homedir()}/.local/bin:${process.env.PATH}`;
      if (isInstalled("aws")) {
        console.log(`  ${chalk.green("✓")} AWS CLI installed to ~/.local/bin/aws`);
        return true;
      }
    } catch { /* fall through */ }
  }

  if (os === "darwin") {
    try {
      const tmpDir = join(homedir(), ".thinkwork", "tmp");
      mkdirSync(tmpDir, { recursive: true });
      const pkgPath = join(tmpDir, "AWSCLIV2.pkg");
      console.log("    Downloading AWS CLI...");
      run(`curl -sL "https://awscli.amazonaws.com/AWSCLIV2.pkg" -o "${pkgPath}"`);
      run(`installer -pkg "${pkgPath}" -target CurrentUserHomeDirectory 2>/dev/null || sudo installer -pkg "${pkgPath}" -target /`);
      if (isInstalled("aws")) {
        console.log(`  ${chalk.green("✓")} AWS CLI installed`);
        return true;
      }
    } catch { /* fall through */ }
  }

  console.log(`  ${chalk.red("✗")} Could not auto-install AWS CLI.`);
  console.log(`    Install manually: ${chalk.cyan("https://aws.amazon.com/cli/")}`);
  return false;
}

export async function ensureTerraform(): Promise<boolean> {
  if (isInstalled("terraform")) return true;

  console.log(`  ${chalk.yellow("→")} Terraform not found. Installing...`);

  const os = platform();

  if ((os === "darwin" || os === "linux") && hasBrew()) {
    const result = run("brew install hashicorp/tap/terraform");
    if (result !== null && isInstalled("terraform")) {
      console.log(`  ${chalk.green("✓")} Terraform installed via Homebrew`);
      return true;
    }
  }

  // Direct binary download
  const tfVersion = "1.12.1";
  const osName = os === "darwin" ? "darwin" : "linux";
  const archName = arch() === "arm64" ? "arm64" : "amd64";
  const url = `https://releases.hashicorp.com/terraform/${tfVersion}/terraform_${tfVersion}_${osName}_${archName}.zip`;

  try {
    const tmpDir = join(homedir(), ".thinkwork", "tmp");
    const binDir = join(homedir(), ".local", "bin");
    mkdirSync(tmpDir, { recursive: true });
    mkdirSync(binDir, { recursive: true });

    const zipPath = join(tmpDir, "terraform.zip");
    console.log(`    Downloading Terraform ${tfVersion}...`);
    run(`curl -sL "${url}" -o "${zipPath}"`);
    run(`unzip -qo "${zipPath}" -d "${binDir}"`);
    chmodSync(join(binDir, "terraform"), 0o755);

    // Add to PATH for this session
    if (!process.env.PATH?.includes(binDir)) {
      process.env.PATH = `${binDir}:${process.env.PATH}`;
    }

    if (isInstalled("terraform")) {
      console.log(`  ${chalk.green("✓")} Terraform ${tfVersion} installed to ~/.local/bin/terraform`);
      return true;
    }
  } catch { /* fall through */ }

  console.log(`  ${chalk.red("✗")} Could not auto-install Terraform.`);
  console.log(`    Install manually: ${chalk.cyan("https://developer.hashicorp.com/terraform/install")}`);
  return false;
}

/**
 * Ensure all prerequisites are installed. Called by `init` before doing anything.
 */
export async function ensurePrerequisites(): Promise<boolean> {
  console.log(chalk.dim("  Checking prerequisites...\n"));

  const awsOk = await ensureAwsCli();
  const tfOk = await ensureTerraform();

  if (awsOk && tfOk) {
    console.log("");
    return true;
  }

  console.log("");
  console.log(`  ${chalk.red("Missing prerequisites.")} Install them and try again.`);
  return false;
}
