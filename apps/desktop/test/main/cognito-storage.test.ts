import { access, mkdtemp, readFile, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  SafeStorageCognitoStorage,
  type SafeStorageLike,
} from "../../src/main/cognito-storage";

const COGNITO_PREFIX = "CognitoIdentityServiceProvider.test-client";

function sleep(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function makeSafeStorage(
  options: {
    available?: boolean;
    backend?: string;
    encrypt?: (plainText: string) => Promise<Buffer>;
    decrypt?: (
      encrypted: Buffer,
    ) => Promise<string | { result: string; shouldReEncrypt?: boolean }>;
  } = {},
): SafeStorageLike & { encryptCalls: () => number } {
  let encryptCalls = 0;

  return {
    isEncryptionAvailable: () => options.available ?? true,
    getSelectedStorageBackend: () => options.backend ?? "unknown",
    encryptStringAsync: async (plainText) => {
      encryptCalls += 1;
      return options.encrypt?.(plainText) ?? Buffer.from(plainText, "utf8");
    },
    decryptStringAsync: async (encrypted) =>
      options.decrypt?.(encrypted) ?? {
        result: encrypted.toString("utf8"),
        shouldReEncrypt: false,
      },
    encryptCalls: () => encryptCalls,
  };
}

async function fileExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

async function waitForFile(
  path: string,
  expected: boolean,
  timeoutMs = 250,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if ((await fileExists(path)) === expected) return;
    await sleep(5);
  }
  expect(await fileExists(path)).toBe(expected);
}

async function waitForJsonFile<T>(path: string, timeoutMs = 250): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  let lastError: unknown;
  while (Date.now() < deadline) {
    try {
      return JSON.parse((await readFile(path)).toString()) as T;
    } catch (error) {
      lastError = error;
      await sleep(5);
    }
  }
  throw lastError;
}

describe("SafeStorageCognitoStorage", () => {
  let userDataDir: string;
  let warnings: unknown[];

  beforeEach(async () => {
    userDataDir = await mkdtemp(join(tmpdir(), "thinkwork-cognito-storage-"));
    warnings = [];
  });

  afterEach(async () => {
    await rm(userDataDir, { recursive: true, force: true });
  });

  async function createStorage(
    safeStorage = makeSafeStorage(),
    flushDebounceMs = 5,
  ): Promise<SafeStorageCognitoStorage> {
    return SafeStorageCognitoStorage.create({
      app: { getPath: () => userDataDir },
      safeStorage,
      flushDebounceMs,
      logger: {
        warn: (_message, error) => warnings.push(error),
      },
    });
  }

  it("returns new values synchronously before the debounced flush runs", async () => {
    const storage = await createStorage();

    storage.setItem("foo", "bar");

    expect(storage.getItem("foo")).toBe("bar");
    expect(await fileExists(storage.vaultPath)).toBe(false);
  });

  it("writes an encrypted vault after the debounce window", async () => {
    const storage = await createStorage();

    storage.setItem("foo", "bar");

    const vault = await waitForJsonFile(storage.vaultPath);
    expect(vault).toEqual({ foo: "bar" });
  });

  it("batches rapid writes into a single disk flush", async () => {
    const safeStorage = makeSafeStorage();
    const storage = await createStorage(safeStorage);

    for (let i = 0; i < 10; i += 1) {
      storage.setItem(`key-${i}`, `value-${i}`);
    }
    await waitForFile(storage.vaultPath, true);

    expect(safeStorage.encryptCalls()).toBe(1);
    expect(storage.getItem("key-9")).toBe("value-9");
  });

  it("falls back to memory when encryption is unavailable", async () => {
    const storage = await createStorage(makeSafeStorage({ available: false }));

    storage.setItem("foo", "bar");
    await sleep(20);

    expect(storage.degradedMode).toBe(true);
    expect(storage.reason).toBe("encryption_unavailable");
    expect(storage.getItem("foo")).toBe("bar");
    expect(await fileExists(storage.vaultPath)).toBe(false);
  });

  it("treats Linux basic_text as degraded in-memory storage", async () => {
    const storage = await createStorage(
      makeSafeStorage({ backend: "basic_text" }),
    );

    storage.setItem("foo", "bar");
    await sleep(20);

    expect(storage.degradedMode).toBe(true);
    expect(storage.reason).toBe("basic_text_backend");
    expect(await fileExists(storage.vaultPath)).toBe(false);
  });

  it("starts empty and marks degraded when the vault is corrupt", async () => {
    const vaultPath = join(userDataDir, "cognito-vault.bin");
    await writeFile(vaultPath, Buffer.from("not-json", "utf8"));

    const storage = await createStorage();

    expect(storage.degradedMode).toBe(true);
    expect(storage.reason).toBe("corrupt_vault");
    expect(storage.getItem("foo")).toBeNull();
    expect(warnings).toHaveLength(1);
  });

  it("hydrates a prior vault with standard Cognito keys", async () => {
    const username = "user@example.com";
    const keys = {
      [`${COGNITO_PREFIX}.LastAuthUser`]: username,
      [`${COGNITO_PREFIX}.${username}.idToken`]: "id-token",
      [`${COGNITO_PREFIX}.${username}.accessToken`]: "access-token",
      [`${COGNITO_PREFIX}.${username}.refreshToken`]: "refresh-token",
      [`${COGNITO_PREFIX}.${username}.clockDrift`]: "0",
    };
    await writeFile(
      join(userDataDir, "cognito-vault.bin"),
      Buffer.from(JSON.stringify(keys), "utf8"),
    );

    const storage = await createStorage();

    for (const [key, value] of Object.entries(keys)) {
      expect(storage.getItem(key)).toBe(value);
    }
  });

  it("keeps the cache correct when an encrypt call fails", async () => {
    const safeStorage = makeSafeStorage({
      encrypt: async () => {
        throw new Error("keychain locked");
      },
    });
    const storage = await createStorage(safeStorage);

    storage.setItem("foo", "bar");
    await sleep(20);
    await sleep(20);

    expect(storage.getItem("foo")).toBe("bar");
    expect(safeStorage.encryptCalls()).toBe(1);
    expect(warnings).toHaveLength(1);
  });

  it("removes the vault file when cleared", async () => {
    const storage = await createStorage();

    storage.setItem("foo", "bar");
    await waitForFile(storage.vaultPath, true);
    expect(await fileExists(storage.vaultPath)).toBe(true);

    storage.clear();
    await waitForFile(storage.vaultPath, false);

    expect(storage.getItem("foo")).toBeNull();
    expect(await fileExists(storage.vaultPath)).toBe(false);
  });
});
