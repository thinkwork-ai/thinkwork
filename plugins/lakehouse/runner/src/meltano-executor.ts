import { spawn } from "node:child_process";
import type { LakeHouseRunnerPolicy } from "../../src/edge-integration";
import { decideRunAllowed } from "../../src/edge-integration";
import { redactSensitiveText } from "./redaction";

export interface MeltanoCommand {
  command: "run" | "invoke";
  args: string[];
}

export interface BuildMeltanoCommandInput {
  jobName: string;
  bundleDigest: string;
  approved: boolean;
  policy: LakeHouseRunnerPolicy;
}

export function buildMeltanoRunCommand(
  input: BuildMeltanoCommandInput,
): MeltanoCommand {
  const decision = decideRunAllowed({
    policy: input.policy,
    jobName: input.jobName,
    bundleDigest: input.bundleDigest,
    approved: input.approved,
  });
  if (!decision.allowed) {
    throw new Error(decision.reason);
  }
  if (!/^[A-Za-z0-9_.:-]+$/.test(input.jobName)) {
    throw new Error("Job name contains unsupported characters");
  }
  return { command: "run", args: [input.jobName] };
}

export async function runMeltanoCommand(input: {
  cwd: string;
  command: MeltanoCommand;
  env?: Record<string, string>;
}): Promise<{ exitCode: number | null; stdout: string; stderr: string }> {
  return new Promise((resolvePromise) => {
    const child = spawn(
      "meltano",
      [input.command.command, ...input.command.args],
      {
        cwd: input.cwd,
        env: { ...process.env, ...input.env },
        shell: false,
      },
    );
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (chunk) => {
      stdout += chunk.toString();
    });
    child.stderr.on("data", (chunk) => {
      stderr += chunk.toString();
    });
    child.on("error", (error) => {
      resolvePromise({
        exitCode: null,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(`${stderr}\n${error.message}`.trim()),
      });
    });
    child.on("close", (exitCode) => {
      resolvePromise({
        exitCode,
        stdout: redactSensitiveText(stdout),
        stderr: redactSensitiveText(stderr),
      });
    });
  });
}
