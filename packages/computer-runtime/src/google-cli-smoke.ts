import { execFile } from "node:child_process";
import { promisify } from "node:util";

const execFileAsync = promisify(execFile);

export async function smokeGoogleWorkspaceCli(
  binary = process.env.GOOGLE_WORKSPACE_CLI_BIN || "google-workspace",
) {
  try {
    const result = await execFileAsync(binary, ["--version"], {
      timeout: 5_000,
    });
    return {
      available: true,
      binary,
      version: result.stdout.trim() || result.stderr.trim(),
    };
  } catch (err) {
    return {
      available: false,
      binary,
      error: err instanceof Error ? err.message : String(err),
    };
  }
}
