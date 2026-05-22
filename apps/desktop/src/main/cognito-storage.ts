import { readFile, unlink, writeFile } from "node:fs/promises";
import { join } from "node:path";

const DEFAULT_FLUSH_DEBOUNCE_MS = 100;

export interface ICognitoStorage {
  setItem(key: string, value: string): string;
  getItem(key: string): string | null;
  removeItem(key: string): boolean;
  clear(): object;
}

export interface SafeStorageLike {
  isEncryptionAvailable(): boolean;
  getSelectedStorageBackend?: () => string;
  encryptStringAsync(plainText: string): Promise<Buffer>;
  decryptStringAsync(
    encrypted: Buffer,
  ): Promise<string | { result: string; shouldReEncrypt?: boolean }>;
}

export interface DesktopAppPathLike {
  getPath(name: "userData"): string;
}

export interface CognitoStorageLogger {
  warn(message: string, error?: unknown): void;
}

export interface SafeStorageCognitoStorageOptions {
  app: DesktopAppPathLike;
  safeStorage: SafeStorageLike;
  logger?: CognitoStorageLogger;
  flushDebounceMs?: number;
}

export class SafeStorageCognitoStorage implements ICognitoStorage {
  readonly vaultPath: string;

  private readonly cache = new Map<string, string>();
  private readonly safeStorage: SafeStorageLike;
  private readonly logger: CognitoStorageLogger;
  private readonly flushDebounceMs: number;
  private flushTimer: ReturnType<typeof setTimeout> | null = null;
  private persistenceAvailable = false;
  private degradedReason: string | null = null;

  private constructor(options: SafeStorageCognitoStorageOptions) {
    this.safeStorage = options.safeStorage;
    this.logger = options.logger ?? console;
    this.flushDebounceMs = options.flushDebounceMs ?? DEFAULT_FLUSH_DEBOUNCE_MS;
    this.vaultPath = join(options.app.getPath("userData"), "cognito-vault.bin");
  }

  static async create(
    options: SafeStorageCognitoStorageOptions,
  ): Promise<SafeStorageCognitoStorage> {
    const storage = new SafeStorageCognitoStorage(options);
    await storage.hydrate();
    return storage;
  }

  get degradedMode(): boolean {
    return this.degradedReason !== null;
  }

  get reason(): string | null {
    return this.degradedReason;
  }

  setItem(key: string, value: string): string {
    this.cache.set(key, value);
    this.scheduleFlush();
    return value;
  }

  getItem(key: string): string | null {
    return this.cache.get(key) ?? null;
  }

  removeItem(key: string): boolean {
    this.cache.delete(key);
    this.scheduleFlush();
    return true;
  }

  clear(): object {
    this.cache.clear();
    this.cancelFlush();
    void this.deleteVaultFile();
    return {};
  }

  async flushNow(): Promise<void> {
    this.cancelFlush();

    if (!this.persistenceAvailable) return;

    try {
      const encrypted = await this.safeStorage.encryptStringAsync(
        JSON.stringify(Object.fromEntries(this.cache)),
      );
      await writeFile(this.vaultPath, encrypted);
    } catch (error) {
      this.logger.warn("[desktop:cognito-storage] vault flush failed", error);
    }
  }

  private async hydrate(): Promise<void> {
    const backend = this.safeStorage.getSelectedStorageBackend?.();

    if (!this.safeStorage.isEncryptionAvailable()) {
      this.markDegraded("encryption_unavailable");
      return;
    }

    if (backend === "basic_text") {
      this.markDegraded("basic_text_backend");
      return;
    }

    this.persistenceAvailable = true;

    let encrypted: Buffer;
    try {
      encrypted = await readFile(this.vaultPath);
    } catch {
      return;
    }

    try {
      const decrypted = await this.safeStorage.decryptStringAsync(encrypted);
      const parsed = JSON.parse(decryptResultText(decrypted));

      if (!isStringRecord(parsed)) {
        throw new Error("vault payload is not a string map");
      }

      for (const [key, value] of Object.entries(parsed)) {
        this.cache.set(key, value);
      }

      if (typeof decrypted === "object" && decrypted.shouldReEncrypt) {
        await this.flushNow();
      }
    } catch (error) {
      this.cache.clear();
      this.persistenceAvailable = false;
      this.markDegraded("corrupt_vault");
      this.logger.warn("[desktop:cognito-storage] vault hydrate failed", error);
    }
  }

  private scheduleFlush(): void {
    if (!this.persistenceAvailable) return;

    this.cancelFlush();
    this.flushTimer = setTimeout(() => {
      this.flushTimer = null;
      void this.flushNow();
    }, this.flushDebounceMs);
  }

  private cancelFlush(): void {
    if (!this.flushTimer) return;
    clearTimeout(this.flushTimer);
    this.flushTimer = null;
  }

  private async deleteVaultFile(): Promise<void> {
    try {
      await unlink(this.vaultPath);
    } catch {
      // Missing vaults are expected for new or degraded sessions.
    }
  }

  private markDegraded(reason: string): void {
    this.degradedReason = reason;
    this.persistenceAvailable = false;
  }
}

function decryptResultText(
  value: string | { result: string; shouldReEncrypt?: boolean },
): string {
  return typeof value === "string" ? value : value.result;
}

function isStringRecord(value: unknown): value is Record<string, string> {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;

  return Object.values(value).every((entry) => typeof entry === "string");
}
