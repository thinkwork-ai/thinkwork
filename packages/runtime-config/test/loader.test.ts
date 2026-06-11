import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  __resetRuntimeConfigForTests,
  deriveFunctionArn,
  deriveFunctionName,
  getApiAuthSecret,
  getAppsyncApiKey,
  getConfig,
  getSecret,
  primeRuntimeConfig,
  requireConfig,
} from "../src/loader.js";

const ssmSend = vi.fn();
const secretsSend = vi.fn();

vi.mock("@aws-sdk/client-ssm", () => ({
  SSMClient: vi.fn(() => ({ send: ssmSend })),
  GetParameterCommand: vi.fn((input) => ({ input })),
}));

vi.mock("@aws-sdk/client-secrets-manager", () => ({
  SecretsManagerClient: vi.fn(() => ({ send: secretsSend })),
  GetSecretValueCommand: vi.fn((input) => ({ input })),
}));

const ENV_KEYS = [
  "STAGE",
  "AWS_LAMBDA_FUNCTION_NAME",
  "AWS_SESSION_TOKEN",
  "AWS_REGION",
  "AWS_DEFAULT_REGION",
  "AWS_ACCOUNT_ID",
  "PARAMETERS_SECRETS_EXTENSION_HTTP_PORT",
  "THINKWORK_RUNTIME_CONFIG_PARAM",
  "TEST_KEY",
  "API_AUTH_SECRET",
  "THINKWORK_API_SECRET",
  "APPSYNC_API_KEY",
];

const savedEnv: Record<string, string | undefined> = {};

beforeEach(() => {
  for (const key of ENV_KEYS) {
    savedEnv[key] = process.env[key];
    delete process.env[key];
  }
  __resetRuntimeConfigForTests();
  ssmSend.mockReset();
  secretsSend.mockReset();
});

afterEach(() => {
  for (const key of ENV_KEYS) {
    if (savedEnv[key] === undefined) delete process.env[key];
    else process.env[key] = savedEnv[key];
  }
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

function primeViaSdk(doc: Record<string, string>) {
  process.env.STAGE = "test";
  ssmSend.mockResolvedValue({ Parameter: { Value: JSON.stringify(doc) } });
  return primeRuntimeConfig({ force: true });
}

describe("getConfig merge order", () => {
  it("returns the env value when set, without consulting the document", async () => {
    await primeViaSdk({ TEST_KEY: "from-doc" });
    process.env.TEST_KEY = "from-env";
    expect(getConfig("TEST_KEY")).toBe("from-env");
  });

  it("treats empty-string env values as unset and falls through to the document", async () => {
    await primeViaSdk({ TEST_KEY: "from-doc" });
    process.env.TEST_KEY = "";
    expect(getConfig("TEST_KEY")).toBe("from-doc");
  });

  it("returns the document value when env is unset", async () => {
    await primeViaSdk({ TEST_KEY: "from-doc" });
    expect(getConfig("TEST_KEY")).toBe("from-doc");
  });

  it("returns the fallback when neither env nor document has the key", async () => {
    await primeViaSdk({});
    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");
    expect(getConfig("TEST_KEY")).toBeUndefined();
  });

  it("serves env values before any prime happens (cold sync read)", () => {
    process.env.TEST_KEY = "early";
    expect(getConfig("TEST_KEY")).toBe("early");
  });

  it("requireConfig throws with the key name when unset", async () => {
    await primeViaSdk({});
    expect(() => requireConfig("TEST_KEY")).toThrow(/TEST_KEY/);
  });

  it("treats empty-string document values as unset (terraform disabled-feature keys)", async () => {
    await primeViaSdk({ TEST_KEY: "" });
    expect(getConfig("TEST_KEY")).toBeUndefined();
    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");
  });
});

describe("cache behavior", () => {
  it("does not refetch within the TTL", async () => {
    await primeViaSdk({ TEST_KEY: "v1" });
    expect(ssmSend).toHaveBeenCalledTimes(1);
    await primeRuntimeConfig();
    expect(ssmSend).toHaveBeenCalledTimes(1);
    expect(getConfig("TEST_KEY")).toBe("v1");
  });

  it("serves stale values and refreshes in the background after TTL expiry", async () => {
    process.env.STAGE = "test";
    ssmSend.mockResolvedValueOnce({
      Parameter: { Value: JSON.stringify({ TEST_KEY: "v1" }) },
    });
    await primeRuntimeConfig({ force: true, ttlMs: 0 });
    ssmSend.mockResolvedValueOnce({
      Parameter: { Value: JSON.stringify({ TEST_KEY: "v2" }) },
    });
    // Stale read returns the old value and kicks off a background refresh.
    expect(getConfig("TEST_KEY")).toBe("v1");
    await vi.waitFor(() => expect(ssmSend).toHaveBeenCalledTimes(2));
    // Restore a real TTL so the final read doesn't strand another background
    // refresh that would pollute the next test's call counts.
    await primeRuntimeConfig({ ttlMs: 60_000 });
    expect(getConfig("TEST_KEY")).toBe("v2");
    expect(ssmSend).toHaveBeenCalledTimes(2);
  });

  it("dedupes concurrent primes into one fetch", async () => {
    process.env.STAGE = "test";
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });
    await Promise.all([
      primeRuntimeConfig({ force: true }),
      primeRuntimeConfig({ force: true }),
    ]);
    expect(ssmSend).toHaveBeenCalledTimes(1);
  });
});

describe("fetch path selection", () => {
  it("uses the extension HTTP endpoint when running in Lambda with a session token", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "thinkwork-test-api-graphql-http";
    process.env.AWS_SESSION_TOKEN = "token-123";
    // env secret copies present → no secret prefetch; isolates the param path
    process.env.API_AUTH_SECRET = "env-secret";
    process.env.APPSYNC_API_KEY = "env-key";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({
        Parameter: { Value: JSON.stringify({ TEST_KEY: "from-extension" }) },
      }),
    });
    vi.stubGlobal("fetch", fetchMock);

    await primeRuntimeConfig({ force: true });

    expect(fetchMock).toHaveBeenCalledTimes(1);
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toContain("http://localhost:2773/systemsmanager/get");
    expect(url).toContain(encodeURIComponent("/thinkwork/test/runtime-config"));
    expect(init.headers["X-Aws-Parameters-Secrets-Token"]).toBe("token-123");
    expect(ssmSend).not.toHaveBeenCalled();
    expect(getConfig("TEST_KEY")).toBe("from-extension");
  });

  it("falls back to the SDK when the extension request fails", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "thinkwork-test-api-graphql-http";
    process.env.AWS_SESSION_TOKEN = "token-123";
    process.env.API_AUTH_SECRET = "env-secret";
    process.env.APPSYNC_API_KEY = "env-key";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    ssmSend.mockResolvedValue({
      Parameter: { Value: JSON.stringify({ TEST_KEY: "from-sdk" }) },
    });

    await primeRuntimeConfig({ force: true });

    expect(ssmSend).toHaveBeenCalledTimes(1);
    expect(getConfig("TEST_KEY")).toBe("from-sdk");
  });

  it("uses the SDK directly outside Lambda", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);
    await primeViaSdk({ TEST_KEY: "from-sdk" });
    expect(fetchMock).not.toHaveBeenCalled();
    expect(getConfig("TEST_KEY")).toBe("from-sdk");
  });

  it("falls back to the SDK when the extension fetch times out", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "thinkwork-test-api-graphql-http";
    process.env.AWS_SESSION_TOKEN = "token-123";
    process.env.API_AUTH_SECRET = "env-secret";
    process.env.APPSYNC_API_KEY = "env-key";
    vi.stubGlobal(
      "fetch",
      vi.fn().mockRejectedValue(Object.assign(new DOMException("timeout", "TimeoutError"))),
    );
    ssmSend.mockResolvedValue({
      Parameter: { Value: JSON.stringify({ TEST_KEY: "from-sdk" }) },
    });

    await primeRuntimeConfig({ force: true });

    expect(ssmSend).toHaveBeenCalledTimes(1);
    expect(getConfig("TEST_KEY")).toBe("from-sdk");
  });

  it("honors THINKWORK_RUNTIME_CONFIG_PARAM over the STAGE-derived name", async () => {
    process.env.STAGE = "test";
    process.env.THINKWORK_RUNTIME_CONFIG_PARAM = "/custom/param";
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });
    await primeRuntimeConfig({ force: true });
    expect(ssmSend.mock.calls[0][0].input.Name).toBe("/custom/param");
  });
});

describe("missing-document degradation", () => {
  it("serves env and defaults when the parameter does not exist, warning once", async () => {
    process.env.STAGE = "test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const notFound = Object.assign(new Error("ParameterNotFound"), {
      name: "ParameterNotFound",
    });
    ssmSend.mockRejectedValue(notFound);

    await primeRuntimeConfig({ force: true });
    await primeRuntimeConfig({ force: true });

    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");
    process.env.TEST_KEY = "from-env";
    expect(getConfig("TEST_KEY")).toBe("from-env");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("never throws from primeRuntimeConfig on load failure and warns once", async () => {
    process.env.STAGE = "test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ssmSend.mockRejectedValue(new Error("ThrottlingException"));

    await expect(primeRuntimeConfig({ force: true })).resolves.toBeUndefined();
    await expect(primeRuntimeConfig({ force: true })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");
  });

  it("keeps the previous document when a refresh fails", async () => {
    vi.spyOn(console, "warn").mockImplementation(() => {});
    await primeViaSdk({ TEST_KEY: "v1" });
    ssmSend.mockRejectedValue(new Error("ThrottlingException"));
    await primeRuntimeConfig({ force: true });
    expect(getConfig("TEST_KEY")).toBe("v1");
  });

  it("runs env-only when no STAGE or explicit parameter name is set", async () => {
    await primeRuntimeConfig({ force: true });
    expect(ssmSend).not.toHaveBeenCalled();
    process.env.TEST_KEY = "from-env";
    expect(getConfig("TEST_KEY")).toBe("from-env");
  });

  it("negative-caches a first-load failure for ~15s instead of the full TTL", async () => {
    process.env.STAGE = "test";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ssmSend.mockRejectedValueOnce(new Error("ThrottlingException"));

    await primeRuntimeConfig({ force: true });
    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");
    expect(ssmSend).toHaveBeenCalledTimes(1);

    // Within the 15s negative window the empty doc is served — no refetch
    // even though a good document is now available.
    ssmSend.mockResolvedValue({
      Parameter: { Value: JSON.stringify({ TEST_KEY: "from-doc" }) },
    });
    await primeRuntimeConfig();
    expect(ssmSend).toHaveBeenCalledTimes(1);
    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");

    // Past the negative TTL (but far inside the normal 5-minute TTL) the
    // doc is stale again and a retry loads the real document.
    const realNow = Date.now();
    vi.spyOn(Date, "now").mockReturnValue(realNow + 16_000);
    await primeRuntimeConfig();
    expect(ssmSend).toHaveBeenCalledTimes(2);
    expect(getConfig("TEST_KEY")).toBe("from-doc");
  });

  it("resolves prime, warns once, and serves fallback on a malformed JSON document", async () => {
    process.env.STAGE = "test";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ssmSend.mockResolvedValue({ Parameter: { Value: "not-json{{" } });

    await expect(primeRuntimeConfig({ force: true })).resolves.toBeUndefined();
    await expect(primeRuntimeConfig({ force: true })).resolves.toBeUndefined();

    expect(warn).toHaveBeenCalledTimes(1);
    expect(getConfig("TEST_KEY", "fallback")).toBe("fallback");
  });
});

describe("getSecret", () => {
  it("fetches via the SDK outside Lambda and caches the value", async () => {
    secretsSend.mockResolvedValue({ SecretString: "s3cret" });
    expect(await getSecret("thinkwork/test/api-auth")).toBe("s3cret");
    expect(await getSecret("thinkwork/test/api-auth")).toBe("s3cret");
    expect(secretsSend).toHaveBeenCalledTimes(1);
  });

  it("fetches via the extension inside Lambda", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    process.env.AWS_SESSION_TOKEN = "token-123";
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      json: async () => ({ SecretString: "ext-secret" }),
    });
    vi.stubGlobal("fetch", fetchMock);

    expect(await getSecret("thinkwork/test/api-auth")).toBe("ext-secret");
    expect(fetchMock.mock.calls[0][0]).toContain("/secretsmanager/get?secretId=");
    expect(secretsSend).not.toHaveBeenCalled();
  });

  it("falls back to the SDK when the extension path fails", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    process.env.AWS_SESSION_TOKEN = "token-123";
    vi.stubGlobal("fetch", vi.fn().mockRejectedValue(new Error("ECONNREFUSED")));
    secretsSend.mockResolvedValue({ SecretString: "sdk-secret" });

    expect(await getSecret("thinkwork/test/api-auth")).toBe("sdk-secret");
    expect(secretsSend).toHaveBeenCalledTimes(1);
  });

  it("throws when the secret cannot be fetched on either path", async () => {
    secretsSend.mockRejectedValue(new Error("AccessDeniedException"));
    await expect(getSecret("thinkwork/test/api-auth")).rejects.toThrow(
      "AccessDeniedException",
    );
  });

  it("dedupes concurrent fetches of the same secret", async () => {
    secretsSend.mockImplementation(
      () => new Promise((resolve) => setTimeout(() => resolve({ SecretString: "v" }), 5)),
    );
    await Promise.all([getSecret("a"), getSecret("a")]);
    expect(secretsSend).toHaveBeenCalledTimes(1);
  });
});

describe("platform secret accessors", () => {
  it("serves THINKWORK_API_SECRET over API_AUTH_SECRET over the cached secret", () => {
    process.env.API_AUTH_SECRET = "from-canonical";
    expect(getApiAuthSecret()).toBe("from-canonical");
    process.env.THINKWORK_API_SECRET = "from-alias";
    expect(getApiAuthSecret()).toBe("from-alias");
  });

  it("returns '' when neither env nor cache has the secret", () => {
    expect(getApiAuthSecret()).toBe("");
    expect(getAppsyncApiKey()).toBe("");
  });

  it("prefetches api-auth + appsync-api-key at Lambda prime when env copies are absent", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });
    secretsSend.mockResolvedValue({ SecretString: "prefetched" });

    await primeRuntimeConfig({ force: true });

    const requested = secretsSend.mock.calls.map((c) => c[0].input.SecretId).sort();
    expect(requested).toEqual(["thinkwork/test/api-auth", "thinkwork/test/appsync-api-key"]);
    expect(getApiAuthSecret()).toBe("prefetched");
    expect(getAppsyncApiKey()).toBe("prefetched");
  });

  it("skips prefetch while the env copies still exist (transition window)", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    process.env.API_AUTH_SECRET = "env-secret";
    process.env.APPSYNC_API_KEY = "env-key";
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });

    await primeRuntimeConfig({ force: true });

    expect(secretsSend).not.toHaveBeenCalled();
    expect(getApiAuthSecret()).toBe("env-secret");
    expect(getAppsyncApiKey()).toBe("env-key");
  });

  it("degrades to '' and warns once when prefetch fails", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });
    secretsSend.mockRejectedValue(new Error("AccessDeniedException"));

    await expect(primeRuntimeConfig({ force: true })).resolves.toBeUndefined();

    expect(getApiAuthSecret()).toBe("");
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it("skips prefetch outside Lambda", async () => {
    process.env.STAGE = "test";
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });
    await primeRuntimeConfig({ force: true });
    expect(secretsSend).not.toHaveBeenCalled();
  });

  it("heals a failed prefetch via a background fetch on accessor miss", async () => {
    process.env.STAGE = "test";
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    vi.spyOn(console, "warn").mockImplementation(() => {});
    ssmSend.mockResolvedValue({ Parameter: { Value: "{}" } });
    // Both platform-secret prefetches (api-auth + appsync-api-key) fail at
    // cold start, then the service recovers.
    secretsSend
      .mockRejectedValueOnce(new Error("ThrottlingException"))
      .mockRejectedValueOnce(new Error("ThrottlingException"))
      .mockResolvedValue({ SecretString: "healed" });

    await primeRuntimeConfig({ force: true });

    // First request after the failed prefetch still serves "" (legacy
    // contract) but fires a background getSecret…
    expect(getApiAuthSecret()).toBe("");
    // …which heals the cache for subsequent requests.
    await vi.waitFor(() => expect(getApiAuthSecret()).toBe("healed"));
  });

  it("no-ops prefetch and returns '' when STAGE is unset inside Lambda", async () => {
    process.env.AWS_LAMBDA_FUNCTION_NAME = "fn";
    await primeRuntimeConfig({ force: true });
    expect(ssmSend).not.toHaveBeenCalled();
    expect(secretsSend).not.toHaveBeenCalled();
    expect(getApiAuthSecret()).toBe("");
    expect(getAppsyncApiKey()).toBe("");
    // The accessor misses must not have fired background fetches either —
    // there is no stage to derive a secret name from.
    expect(secretsSend).not.toHaveBeenCalled();
  });
});

describe("derive-by-convention", () => {
  it("derives function names from STAGE", () => {
    process.env.STAGE = "dev";
    expect(deriveFunctionName("email-send")).toBe("thinkwork-dev-api-email-send");
  });

  it("throws when STAGE is unavailable", () => {
    expect(() => deriveFunctionName("email-send")).toThrow(/STAGE/);
  });

  it("derives full ARNs from identity env", () => {
    process.env.STAGE = "dev";
    process.env.AWS_REGION = "us-east-1";
    process.env.AWS_ACCOUNT_ID = "123456789012";
    expect(deriveFunctionArn("email-send")).toBe(
      "arn:aws:lambda:us-east-1:123456789012:function:thinkwork-dev-api-email-send",
    );
  });

  it("deriveFunctionArn throws when region is unset", () => {
    process.env.STAGE = "dev";
    process.env.AWS_ACCOUNT_ID = "123456789012";
    expect(() => deriveFunctionArn("email-send")).toThrow(/region or AWS_ACCOUNT_ID/);
  });

  it("deriveFunctionArn throws when AWS_ACCOUNT_ID is unset", () => {
    process.env.STAGE = "dev";
    process.env.AWS_REGION = "us-east-1";
    expect(() => deriveFunctionArn("email-send")).toThrow(/region or AWS_ACCOUNT_ID/);
  });
});
