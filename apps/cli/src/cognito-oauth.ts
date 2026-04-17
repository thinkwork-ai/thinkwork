/**
 * Cognito OAuth2 authorization-code flow over a local loopback listener.
 *
 * Mirrors how `gh auth login` or `aws sso login` work: the CLI spins up an
 * HTTP server on 127.0.0.1, opens the hosted UI in the user's browser, and
 * waits for Cognito to redirect back with an authorization `code` which we
 * then exchange for tokens.
 *
 * The loopback port (42010) is registered in the admin Cognito client's
 * callback URL list — see terraform/modules/foundation/cognito/variables.tf.
 * Cognito requires an exact URL match so the port is fixed. If it's busy
 * (likely because the admin dev server is using 5174 and… wait, different
 * port — so only if another CLI login is in progress) we surface a clear
 * "port in use" error so the user knows to kill the conflict.
 *
 * No PKCE here — Cognito's hosted UI supports confidential + public clients
 * and the admin client is set up without `client_secret`, so the plain code
 * exchange is sufficient. (PKCE can be layered in later if we introduce a
 * confidential client.)
 */

import { createServer, type IncomingMessage, type ServerResponse } from "node:http";
import { AddressInfo } from "node:net";
import { randomBytes } from "node:crypto";
import { spawn } from "node:child_process";
import chalk from "chalk";
import type { CognitoConfig } from "./cognito-discovery.js";
import { logStderr } from "./lib/output.js";

export const CLI_LOOPBACK_PORT = 42010;
const CALLBACK_PATH = "/callback";
const DEFAULT_TIMEOUT_MS = 5 * 60 * 1000; // 5 minutes

export interface CognitoTokens {
  idToken: string;
  accessToken: string;
  refreshToken: string;
  /** Unix seconds when the id/access token expires. */
  expiresAt: number;
}

export interface LoginOptions {
  cognito: CognitoConfig;
  /** Override the loopback port (useful in tests). Defaults to CLI_LOOPBACK_PORT. */
  port?: number;
  /** Abort the flow after this many ms. Defaults to 5 minutes. */
  timeoutMs?: number;
  /** When false, only print the URL instead of trying `open`. */
  openBrowser?: boolean;
  /** Inject a test-friendly browser launcher. */
  launchBrowser?: (url: string) => void;
}

export async function loginWithCognito(
  opts: LoginOptions,
): Promise<CognitoTokens> {
  const port = opts.port ?? CLI_LOOPBACK_PORT;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const redirectUri = `http://127.0.0.1:${port}${CALLBACK_PATH}`;
  const state = randomBytes(16).toString("hex");

  const authorizeUrl = buildAuthorizeUrl(opts.cognito, redirectUri, state);

  const code = await waitForCallbackCode({
    port,
    expectedState: state,
    timeoutMs,
    onListening: () => {
      logStderr("");
      logStderr(`  ${chalk.cyan("Opening browser to sign in…")}`);
      logStderr(`  ${chalk.dim("If it doesn't open automatically, visit:")}`);
      logStderr(`  ${chalk.dim(authorizeUrl)}`);
      logStderr("");
      if (opts.openBrowser !== false) {
        (opts.launchBrowser ?? openInBrowser)(authorizeUrl);
      }
    },
  });

  return exchangeCodeForTokens(opts.cognito, redirectUri, code);
}

// ---------------------------------------------------------------------------
// URL construction
// ---------------------------------------------------------------------------

function buildAuthorizeUrl(
  cognito: CognitoConfig,
  redirectUri: string,
  state: string,
): string {
  const params = new URLSearchParams({
    client_id: cognito.clientId,
    response_type: "code",
    scope: "openid email profile",
    redirect_uri: redirectUri,
    state,
  });
  return `${cognito.domainUrl}/oauth2/authorize?${params.toString()}`;
}

// ---------------------------------------------------------------------------
// Loopback listener
// ---------------------------------------------------------------------------

interface WaitOptions {
  port: number;
  expectedState: string;
  timeoutMs: number;
  onListening?: () => void;
}

function waitForCallbackCode(opts: WaitOptions): Promise<string> {
  return new Promise((resolve, reject) => {
    const server = createServer((req, res) => handleRequest(req, res));
    let finished = false;

    const finish = (err: Error | null, code?: string): void => {
      if (finished) return;
      finished = true;
      clearTimeout(timer);
      // Kill any keep-alive sockets so server.close() doesn't block on them —
      // the browser typically holds the connection open for ~seconds after
      // receiving the success page.
      // Node 18.2+ has closeAllConnections; guard the call for older runtimes.
      const closer = server as unknown as { closeAllConnections?: () => void };
      closer.closeAllConnections?.();
      server.close(() => {
        if (err) reject(err);
        else resolve(code!);
      });
    };

    const timer = setTimeout(() => {
      finish(
        new Error(
          `Timed out waiting for sign-in after ${Math.round(opts.timeoutMs / 1000)}s. Cancel with Ctrl+C and retry.`,
        ),
      );
    }, opts.timeoutMs);

    function handleRequest(
      req: IncomingMessage,
      res: ServerResponse,
    ): void {
      if (!req.url) return;
      const parsed = new URL(req.url, `http://127.0.0.1:${opts.port}`);
      if (parsed.pathname !== CALLBACK_PATH) {
        res.writeHead(404, { "content-type": "text/plain" });
        res.end("Not found. Return to your CLI and close this tab.");
        return;
      }
      const code = parsed.searchParams.get("code");
      const state = parsed.searchParams.get("state");
      const error = parsed.searchParams.get("error");

      if (error) {
        const desc = parsed.searchParams.get("error_description") || error;
        res.writeHead(400, { "content-type": "text/html; charset=utf-8" });
        res.end(renderErrorPage(desc));
        finish(new Error(`Cognito returned an error: ${desc}`));
        return;
      }

      if (!code || !state) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("Missing code or state.");
        finish(new Error("Cognito callback missing code or state parameter."));
        return;
      }

      if (state !== opts.expectedState) {
        res.writeHead(400, { "content-type": "text/plain" });
        res.end("State mismatch.");
        finish(
          new Error(
            "OAuth state parameter didn't match — possible CSRF or stale tab. Retry `thinkwork login`.",
          ),
        );
        return;
      }

      res.writeHead(200, { "content-type": "text/html; charset=utf-8", connection: "close" });
      res.end(renderSuccessPage());
      finish(null, code);
    }

    server.on("error", (err: NodeJS.ErrnoException) => {
      if (err.code === "EADDRINUSE") {
        finish(
          new Error(
            `Port ${opts.port} is in use. Stop the conflicting process (another \`thinkwork login\`?) and retry.`,
          ),
        );
      } else {
        finish(err);
      }
    });

    server.listen(opts.port, "127.0.0.1", () => {
      opts.onListening?.();
    });
  });
}

// ---------------------------------------------------------------------------
// Token exchange
// ---------------------------------------------------------------------------

interface TokenResponse {
  id_token: string;
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

async function exchangeCodeForTokens(
  cognito: CognitoConfig,
  redirectUri: string,
  code: string,
): Promise<CognitoTokens> {
  const body = new URLSearchParams({
    grant_type: "authorization_code",
    client_id: cognito.clientId,
    code,
    redirect_uri: redirectUri,
  });

  const res = await fetch(`${cognito.domainUrl}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });

  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token exchange failed (HTTP ${res.status}): ${text || "no body"}`,
    );
  }

  const json = (await res.json()) as TokenResponse;
  return {
    idToken: json.id_token,
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

/**
 * Refresh an expired id/access token using the stored refresh_token. Cognito
 * doesn't rotate refresh tokens here, so we keep the existing one.
 */
export async function refreshCognitoTokens(
  cognito: CognitoConfig,
  refreshToken: string,
): Promise<Omit<CognitoTokens, "refreshToken">> {
  const body = new URLSearchParams({
    grant_type: "refresh_token",
    client_id: cognito.clientId,
    refresh_token: refreshToken,
  });
  const res = await fetch(`${cognito.domainUrl}/oauth2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: body.toString(),
  });
  if (!res.ok) {
    const text = await res.text().catch(() => "");
    throw new Error(
      `Token refresh failed (HTTP ${res.status}): ${text || "no body"}`,
    );
  }
  const json = (await res.json()) as Omit<TokenResponse, "refresh_token">;
  return {
    idToken: json.id_token,
    accessToken: json.access_token,
    expiresAt: Math.floor(Date.now() / 1000) + json.expires_in,
  };
}

// ---------------------------------------------------------------------------
// JWT decoding (no signature check — we trust our own Cognito on a known URL)
// ---------------------------------------------------------------------------

export interface IdTokenClaims {
  sub: string;
  email?: string;
  "cognito:username"?: string;
  "custom:tenant_id"?: string;
  exp: number;
  iat: number;
}

export function decodeIdToken(idToken: string): IdTokenClaims {
  const parts = idToken.split(".");
  if (parts.length !== 3) {
    throw new Error("Malformed id_token (expected 3 parts).");
  }
  const payload = parts[1].replace(/-/g, "+").replace(/_/g, "/");
  const padded = payload + "=".repeat((4 - (payload.length % 4)) % 4);
  const json = Buffer.from(padded, "base64").toString("utf-8");
  return JSON.parse(json) as IdTokenClaims;
}

// ---------------------------------------------------------------------------
// Browser launcher (cross-platform)
// ---------------------------------------------------------------------------

function openInBrowser(url: string): void {
  const platform = process.platform;
  const cmd =
    platform === "darwin"
      ? "open"
      : platform === "win32"
        ? "cmd"
        : "xdg-open";
  const args =
    platform === "win32" ? ["/c", "start", "", url] : [url];
  try {
    spawn(cmd, args, { stdio: "ignore", detached: true }).unref();
  } catch {
    // Best-effort. We already printed the URL so the user can paste it.
  }
}

// ---------------------------------------------------------------------------
// Success / error pages shown in the browser tab
// ---------------------------------------------------------------------------

function renderSuccessPage(): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Thinkwork — signed in</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { padding: 2rem 3rem; background: #171717; border: 1px solid #262626; border-radius: 12px; text-align: center; max-width: 28rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #a3a3a3; margin: 0; line-height: 1.5; }
  .check { color: #10b981; font-size: 2rem; }
</style>
</head><body>
<div class="card">
  <div class="check">✓</div>
  <h1>Signed in to Thinkwork</h1>
  <p>You can close this tab and return to your terminal.</p>
</div>
</body></html>`;
}

function renderErrorPage(message: string): string {
  return `<!doctype html>
<html><head><meta charset="utf-8"><title>Thinkwork — sign-in error</title>
<style>
  body { font-family: -apple-system, system-ui, sans-serif; background: #0a0a0a; color: #e5e5e5; display: flex; align-items: center; justify-content: center; min-height: 100vh; margin: 0; }
  .card { padding: 2rem 3rem; background: #171717; border: 1px solid #262626; border-radius: 12px; text-align: center; max-width: 28rem; }
  h1 { font-size: 1.25rem; margin: 0 0 0.5rem; }
  p { color: #fca5a5; margin: 0; line-height: 1.5; }
  code { display: block; margin-top: 1rem; padding: 0.75rem; background: #0a0a0a; border-radius: 6px; color: #a3a3a3; text-align: left; white-space: pre-wrap; word-break: break-word; font-size: 0.875rem; }
</style>
</head><body>
<div class="card">
  <h1>Sign-in failed</h1>
  <p>Return to your terminal for details.</p>
  <code>${escapeHtml(message)}</code>
</div>
</body></html>`;
}

function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => {
    switch (c) {
      case "&": return "&amp;";
      case "<": return "&lt;";
      case ">": return "&gt;";
      case '"': return "&quot;";
      case "'": return "&#39;";
      default: return c;
    }
  });
}
