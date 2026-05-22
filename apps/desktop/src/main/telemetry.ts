import { readFile, writeFile } from "node:fs/promises";
import { join } from "node:path";
import type { UpdateTelemetryEvent } from "@thinkwork/desktop-ipc";

export interface TelemetryAppLike {
  getPath(name: "userData"): string;
  getVersion(): string;
}

export interface UpdateTelemetryOptions {
  app: TelemetryAppLike;
  emit: (event: UpdateTelemetryEvent) => void;
  logger?: Pick<typeof console, "warn">;
}

interface LastKnownVersionFile {
  version: string;
  pendingDownloadedVersion?: string | null;
}

export class UpdateTelemetry {
  private readonly app: TelemetryAppLike;
  private readonly emitEvent: (event: UpdateTelemetryEvent) => void;
  private readonly logger: Pick<typeof console, "warn">;
  private readonly path: string;

  constructor(options: UpdateTelemetryOptions) {
    this.app = options.app;
    this.emitEvent = options.emit;
    this.logger = options.logger ?? console;
    this.path = join(this.app.getPath("userData"), "last-known-version.json");
  }

  async reportLaunchOutcome(): Promise<void> {
    const currentVersion = this.app.getVersion();
    const previous = await this.readLastKnownVersion();
    if (!previous) {
      await this.writeLastKnownVersion({ version: currentVersion });
      return;
    }

    const pending = previous.pendingDownloadedVersion;
    if (
      pending &&
      currentVersion === pending &&
      currentVersion !== previous.version
    ) {
      this.emitEvent({
        type: "update.install_completed",
        version: currentVersion,
        fromVersion: previous.version,
      });
    } else if (pending && currentVersion === previous.version) {
      this.emitEvent({
        type: "update.install_failed_or_skipped",
        version: currentVersion,
        fromVersion: previous.version,
        attemptedVersion: pending,
      });
    }

    await this.writeLastKnownVersion({ version: currentVersion });
  }

  async reportDownloadCompleted(input: {
    version: string;
    channel: string;
    fromVersion: string;
  }): Promise<void> {
    this.emitEvent({
      type: "update.download_completed",
      version: input.version,
      channel: input.channel,
      fromVersion: input.fromVersion,
    });
    await this.writeLastKnownVersion({
      version: input.fromVersion,
      pendingDownloadedVersion: input.version,
    });
  }

  async reportRendererOutcome(outcome: {
    version: string;
    outcome: "installed" | "failed" | "skipped";
    error?: string;
  }): Promise<void> {
    if (outcome.outcome === "installed") {
      await this.writeLastKnownVersion({ version: outcome.version });
    }
  }

  private async readLastKnownVersion(): Promise<LastKnownVersionFile | null> {
    try {
      const parsed = JSON.parse(await readFile(this.path, "utf8"));
      if (!isLastKnownVersionFile(parsed)) return null;
      return parsed;
    } catch {
      return null;
    }
  }

  private async writeLastKnownVersion(
    value: LastKnownVersionFile,
  ): Promise<void> {
    try {
      await writeFile(this.path, JSON.stringify(value), "utf8");
    } catch (error) {
      this.logger.warn(
        "[desktop:updates] version telemetry write failed",
        error,
      );
    }
  }
}

function isLastKnownVersionFile(value: unknown): value is LastKnownVersionFile {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Record<string, unknown>;
  return (
    typeof record.version === "string" &&
    (record.pendingDownloadedVersion == null ||
      typeof record.pendingDownloadedVersion === "string")
  );
}
