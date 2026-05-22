import { spawnSync, type SpawnSyncReturns } from "node:child_process";

export interface AppleTeamIdentifierVerificationOptions {
  platform: NodeJS.Platform;
  isPackaged: boolean;
  expectedTeamId: string;
  executablePath: string;
  spawn?: typeof spawnSync;
}

export interface AppleTeamIdentifierVerificationResult {
  checked: boolean;
  teamId: string | null;
}

export function verifyAppleTeamIdentifier({
  platform,
  isPackaged,
  expectedTeamId,
  executablePath,
  spawn = spawnSync,
}: AppleTeamIdentifierVerificationOptions): AppleTeamIdentifierVerificationResult {
  const normalizedExpectedTeamId = expectedTeamId.trim();
  if (platform !== "darwin" || !isPackaged || !normalizedExpectedTeamId) {
    return { checked: false, teamId: null };
  }

  const teamId = readAppleTeamIdentifier(executablePath, spawn);
  if (teamId !== normalizedExpectedTeamId) {
    throw new Error(
      `Unexpected macOS signing team identifier: ${teamId ?? "unknown"}`,
    );
  }

  return { checked: true, teamId };
}

export function readAppleTeamIdentifier(
  executablePath: string,
  spawn: typeof spawnSync = spawnSync,
): string | null {
  const result = spawn("codesign", ["-dv", "--verbose=4", executablePath], {
    encoding: "utf8",
  }) as SpawnSyncReturns<string>;
  if (result.status !== 0) return null;

  const output = `${result.stdout ?? ""}\n${result.stderr ?? ""}`;
  return output.match(/^TeamIdentifier=(\S+)$/m)?.[1] ?? null;
}
