import {
  chmodSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { execFileSync, spawnSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";

const __dirname = dirname(fileURLToPath(import.meta.url));
const REPO_ROOT = resolve(__dirname, "../../..");
const BOOTSTRAP = resolve(
  REPO_ROOT,
  "terraform/modules/app/agentcore-identity/scripts/bootstrap_twenty_oauth_client.sh",
);
const scratch: string[] = [];

function executable(path: string, body: string): void {
  writeFileSync(path, `#!/usr/bin/env bash\nset -euo pipefail\n${body}`);
  chmodSync(path, 0o755);
}

function mockEnvironment(
  options: {
    confidential?: boolean;
    failRealProviderOnce?: boolean;
    omitClientSecret?: boolean;
    registrationEndpoint?: string;
  } = {},
) {
  const root = mkdtempSync(join(tmpdir(), "thinkwork-twenty-dcr-"));
  scratch.push(root);
  const bin = join(root, "bin");
  execFileSync("mkdir", ["-p", bin]);

  executable(
    join(bin, "aws"),
    `
state="\${MOCK_STATE_DIR:?}/secret.json"
if [[ "\${1:-} \${2:-}" == "secretsmanager get-secret-value" ]]; then
  [[ -f "$state" ]] || exit 255
  cat "$state"
elif [[ "\${1:-} \${2:-}" == "secretsmanager put-secret-value" ]]; then
  cat >"$state"
else
  printf 'unexpected aws call: %s\\n' "$*" >&2
  exit 64
fi
`,
  );
  executable(
    join(bin, "node"),
    `
input="$(cat)"
client_id="$(jq -r '.clientId' <<<"$input")"
printf '%s\\n' "$client_id" >>"$MOCK_STATE_DIR/provider-client-ids.log"
if [[ "\${MOCK_FAIL_REAL_PROVIDER_ONCE:-}" == "1" && "$client_id" == "twenty-client" && ! -f "$MOCK_STATE_DIR/real-provider-failed" ]]; then
  touch "$MOCK_STATE_DIR/real-provider-failed"
  exit 70
fi
jq -n \\
  --arg name "$(jq -r '.name' <<<"$input")" \\
  --arg client_id "$client_id" \\
  --arg secret_arn "$(jq -r '.secretArn' <<<"$input")" \\
  '{name:$name,clientId:$client_id,callbackUrl:"https://bedrock-agentcore.us-east-1.amazonaws.com/identities/oauth2/callback/provider-123",credentialProviderArn:"arn:aws:bedrock-agentcore:us-east-1:123456789012:token-vault/default/oauth2credentialprovider/test",clientSecretArn:$secret_arn,clientSecretJsonKey:"client_secret",clientSecretSource:"EXTERNAL",status:"READY"}'
`,
  );
  executable(
    join(bin, "openssl"),
    `
if [[ "$*" == *"-hex"* ]]; then
  printf '%s\\n' '0123456789abcdef01234567'
else
  printf '%s\\n' 'placeholder-secret'
fi
`,
  );
  executable(
    join(bin, "curl"),
    `
if [[ "$*" == *".well-known/oauth-authorization-server"* ]]; then
  printf '%s\\n' discovery >>"$MOCK_STATE_DIR/curl.log"
  jq -n '{issuer:"https://crm.example.test",registration_endpoint:"${options.registrationEndpoint ?? "https://crm.example.test/oauth/register"}",grant_types_supported:["authorization_code","refresh_token"],token_endpoint_auth_methods_supported:${options.confidential === false ? '["none"]' : '["client_secret_post","none"]'},scopes_supported:["api","profile"]}'
  exit 0
fi
printf '%s\\n' registration >>"$MOCK_STATE_DIR/curl.log"
payload=""
while (($#)); do
  if [[ "$1" == "--data-binary" ]]; then
    shift
    payload="$1"
    break
  fi
  shift
done
callback="$(jq -r '.redirect_uris[0]' <<<"$payload")"
jq -n --arg callback "$callback" '{client_id:"twenty-client",client_secret:${options.omitClientSecret ? '""' : '"twenty-secret"'},client_name:"ThinkWork AgentCore Identity Twenty CRM",redirect_uris:[$callback],grant_types:["authorization_code"],response_types:["code"],token_endpoint_auth_method:"client_secret_post",scope:"api profile",registration_access_token:"registration-token",registration_client_uri:"https://crm.example.test/oauth/register/twenty-client"}'
`,
  );

  return {
    root,
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      MOCK_STATE_DIR: root,
      AWS_REGION: "us-east-1",
      TWENTY_OAUTH_ISSUER: "https://crm.example.test",
      TWENTY_CLIENT_SECRET_ARN:
        "arn:aws:secretsmanager:us-east-1:123456789012:secret:twenty-client",
      TWENTY_CREDENTIAL_PROVIDER_NAME: "thinkwork-test-twenty-crm",
      ...(options.failRealProviderOnce
        ? { MOCK_FAIL_REAL_PROVIDER_ONCE: "1" }
        : {}),
    },
  };
}

afterEach(() => {
  for (const path of scratch.splice(0)) rmSync(path, { recursive: true });
});

describe("AgentCore downstream confidential-client bootstrap", () => {
  it("registers after obtaining the provider callback and reuses the registration", () => {
    const { root, env } = mockEnvironment();

    const first = JSON.parse(
      execFileSync("bash", [BOOTSTRAP], { env, encoding: "utf8" }),
    );
    expect(first).toMatchObject({
      clientId: "twenty-client",
      clientSecretJsonKey: "client_secret",
      clientSecretSource: "EXTERNAL",
      status: "READY",
    });
    expect(
      readFileSync(join(root, "provider-client-ids.log"), "utf8")
        .trim()
        .split("\n"),
    ).toEqual([
      "thinkwork-bootstrap-0123456789abcdef01234567",
      "twenty-client",
    ]);
    expect(
      readFileSync(join(root, "curl.log"), "utf8").trim().split("\n"),
    ).toEqual(["discovery", "registration"]);
    expect(
      JSON.parse(readFileSync(join(root, "secret.json"), "utf8")),
    ).toMatchObject({
      bootstrap_state: "ready",
      client_id: "twenty-client",
      client_secret: "twenty-secret",
      redirect_uris: [
        "https://bedrock-agentcore.us-east-1.amazonaws.com/identities/oauth2/callback/provider-123",
      ],
      token_endpoint_auth_method: "client_secret_post",
    });

    const second = JSON.parse(
      execFileSync("bash", [BOOTSTRAP], { env, encoding: "utf8" }),
    );
    expect(second.clientId).toBe("twenty-client");
    expect(
      readFileSync(join(root, "curl.log"), "utf8").trim().split("\n"),
    ).toEqual([
      "discovery",
      "registration",
      // Reuse runs re-resolve provider endpoints from discovery metadata.
      "discovery",
    ]);
    expect(
      readFileSync(join(root, "provider-client-ids.log"), "utf8")
        .trim()
        .split("\n"),
    ).toEqual([
      "thinkwork-bootstrap-0123456789abcdef01234567",
      "twenty-client",
      "twenty-client",
    ]);
  });

  it("fails closed when discovery does not advertise confidential clients", () => {
    const { root, env } = mockEnvironment({ confidential: false });
    expect(() =>
      execFileSync("bash", [BOOTSTRAP], {
        env,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    expect(readFileSync(join(root, "curl.log"), "utf8").trim()).toBe(
      "discovery",
    );
  });

  it("rejects a registration endpoint on a lookalike issuer origin", () => {
    const { root, env } = mockEnvironment({
      registrationEndpoint: "https://crm.example.test.evil/oauth/register",
    });
    const result = spawnSync("bash", [BOOTSTRAP], { env, encoding: "utf8" });
    expect(result.status).not.toBe(0);
    expect(result.stderr).toContain("not on the exact issuer origin");
    expect(readFileSync(join(root, "curl.log"), "utf8").trim()).toBe(
      "discovery",
    );
  });

  it("resumes after secret persistence without registering another client", () => {
    const { root, env } = mockEnvironment({ failRealProviderOnce: true });
    expect(() =>
      execFileSync("bash", [BOOTSTRAP], {
        env,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    expect(
      JSON.parse(readFileSync(join(root, "secret.json"), "utf8")),
    ).toMatchObject({
      bootstrap_state: "ready",
      client_id: "twenty-client",
    });

    const resumed = JSON.parse(
      execFileSync("bash", [BOOTSTRAP], { env, encoding: "utf8" }),
    );
    expect(resumed.clientId).toBe("twenty-client");
    expect(
      readFileSync(join(root, "curl.log"), "utf8").trim().split("\n"),
    ).toEqual([
      "discovery",
      "registration",
      // Resume runs re-resolve provider endpoints from discovery metadata.
      "discovery",
    ]);
  });

  it("does not persist a public DCR response without a client secret", () => {
    const { root, env } = mockEnvironment({ omitClientSecret: true });
    expect(() =>
      execFileSync("bash", [BOOTSTRAP], {
        env,
        encoding: "utf8",
        stdio: "pipe",
      }),
    ).toThrow();
    expect(
      JSON.parse(readFileSync(join(root, "secret.json"), "utf8")),
    ).toMatchObject({
      bootstrap_state: "placeholder",
    });
    expect(
      readFileSync(join(root, "provider-client-ids.log"), "utf8").trim(),
    ).toMatch(/^thinkwork-bootstrap-/);
  });

  it("never emits client or registration secrets on success or failure", () => {
    const success = mockEnvironment();
    const successResult = spawnSync("bash", [BOOTSTRAP], {
      env: success.env,
      encoding: "utf8",
    });
    expect(successResult.status).toBe(0);
    expect(`${successResult.stdout}${successResult.stderr}`).not.toMatch(
      /twenty-secret|registration-token/,
    );

    const failure = mockEnvironment({ omitClientSecret: true });
    const failureResult = spawnSync("bash", [BOOTSTRAP], {
      env: failure.env,
      encoding: "utf8",
    });
    expect(failureResult.status).not.toBe(0);
    expect(`${failureResult.stdout}${failureResult.stderr}`).not.toMatch(
      /registration-token/,
    );
  });

  it("fails closed when a managed runtime is configured without its entrypoint", () => {
    const { root, env } = mockEnvironment();
    const runtimeDir = join(root, "missing-managed-runtime");
    execFileSync("mkdir", ["-p", runtimeDir]);

    const result = spawnSync("bash", [BOOTSTRAP], {
      env: {
        ...env,
        THINKWORK_AGENTCORE_CONTROL_RUNTIME_DIR: runtimeDir,
      },
      encoding: "utf8",
    });

    expect(result.status).toBe(66);
    expect(result.stderr).toContain(
      "Managed AgentCore control runtime is missing reconcile_twenty_provider.js",
    );
    expect(`${result.stdout}${result.stderr}`).not.toContain(
      "ERR_MODULE_NOT_FOUND",
    );
  });
});
