/**
 * Capability-broker SDK source bundler (THINK-280 U4).
 *
 * The pure-stdlib Python SDK (`capability-sdk/*.py`) is CLIENT code that runs
 * inside an AgentCore Code Interpreter session. The trusted host materializes it
 * into a session by writing these files, plus a per-session bootstrap file at a
 * reserved path (chmod 0600). This module exposes the SDK source as string assets
 * and builds the bootstrap file content, so the host's `writeFiles` wiring has a
 * single, testable source of truth.
 *
 * The `.py` files are read from disk beside this module so the committed sources
 * and the shipped bytes can never drift. There is no env access here; if any is
 * added later, wrap it in a function (vitest env-capture rule).
 */

import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

/** Directory holding the committed Python SDK sources. */
const SDK_SOURCE_DIR = path.join(
  path.dirname(fileURLToPath(import.meta.url)),
  "capability-sdk",
);

/**
 * Python module basenames, in dependency order. `__init__.py` makes the target a
 * proper package so the materialized directory is importable under its (valid)
 * target name.
 */
export const CAPABILITY_SDK_MODULE_FILES = [
  "canonical.py",
  "ed25519.py",
  "client.py",
  "__init__.py",
] as const;

/**
 * Default target package directory inside a session. Underscored (not the
 * repo's hyphenated source dir) so it is a valid Python package identifier.
 */
export const CAPABILITY_SDK_TARGET_DIR = "capability_sdk";

/** Reserved bootstrap filename + POSIX mode the SDK expects. */
export const CAPABILITY_SDK_BOOTSTRAP_FILENAME = "session-bootstrap.json";
export const CAPABILITY_SDK_BOOTSTRAP_MODE = 0o600;

export interface SdkSourceFile {
  /** Session-relative POSIX path to write. */
  path: string;
  /** UTF-8 file content. */
  content: string;
}

/**
 * Return the SDK `.py` files as `{ path, content }` assets, rooted at
 * `targetDir` (default {@link CAPABILITY_SDK_TARGET_DIR}). The host writes each
 * into the session verbatim.
 */
export function capabilitySdkSourceFiles(
  targetDir: string = CAPABILITY_SDK_TARGET_DIR,
): SdkSourceFile[] {
  return CAPABILITY_SDK_MODULE_FILES.map((name) => ({
    path: `${targetDir}/${name}`,
    content: readFileSync(path.join(SDK_SOURCE_DIR, name), "utf8"),
  }));
}

export interface CapabilitySdkBootstrapInput {
  sessionId: string;
  audience: string;
  /** Endpoint-specific VPCE DNS name (private DNS disabled — THINK-144). */
  brokerEndpoint: string;
  /** Private REST API id targeted through the VPCE. */
  brokerApiId: string;
  /** Base64 PKCS#8 DER Ed25519 private key (session-scoped, <=15 min). */
  privateKey: string;
  /** Next sequence to allocate (starts at 0). */
  nextSequence: number;
  expiresAt: string;
  /** AWS region for the execute-api Host header (defaults resolved SDK-side). */
  region?: string;
  /** Override invocation path (default "/"). */
  invokePath?: string;
  /** Explicit Host header override (else derived from brokerApiId + region). */
  hostHeader?: string;
}

/**
 * Build the JSON content of the bootstrap file the SDK reads. The shape mirrors
 * `SessionBootstrap` (capability-contracts/session.ts) plus the private-DNS-off
 * transport fields the Python client needs; keys are the exact camelCase names
 * {@link CapabilitySdkBootstrapInput} declares, which `SessionBootstrap.from_dict`
 * consumes. NEVER logged — it carries the session private key.
 */
export function buildCapabilitySdkBootstrapContent(
  input: CapabilitySdkBootstrapInput,
): string {
  const payload: Record<string, unknown> = {
    sessionId: input.sessionId,
    audience: input.audience,
    brokerEndpoint: input.brokerEndpoint,
    brokerApiId: input.brokerApiId,
    privateKey: input.privateKey,
    nextSequence: input.nextSequence,
    expiresAt: input.expiresAt,
  };
  if (input.region !== undefined) payload.region = input.region;
  if (input.invokePath !== undefined) payload.invokePath = input.invokePath;
  if (input.hostHeader !== undefined) payload.hostHeader = input.hostHeader;
  return `${JSON.stringify(payload, null, 2)}\n`;
}

/**
 * The reserved bootstrap file target (path + mode) for a given SDK target dir.
 * The host's `writeFiles` call must apply {@link CAPABILITY_SDK_BOOTSTRAP_MODE}
 * so the client's permission check (rejects group/other access) passes.
 */
export function capabilitySdkBootstrapTarget(
  targetDir: string = CAPABILITY_SDK_TARGET_DIR,
): { path: string; mode: number } {
  return {
    path: `${targetDir}/${CAPABILITY_SDK_BOOTSTRAP_FILENAME}`,
    mode: CAPABILITY_SDK_BOOTSTRAP_MODE,
  };
}
