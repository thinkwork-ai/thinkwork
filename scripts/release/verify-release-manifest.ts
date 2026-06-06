#!/usr/bin/env tsx
import { readFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";

import {
  assertManifestCompatible,
  validateReleaseManifest,
  validateReleaseManifestSignature,
  verifyReleaseManifest,
  type TrustedReleaseKey,
} from "../../packages/release-manifest/src/index";

interface ParsedArgs {
  manifestPath?: string;
  signaturePath?: string;
  trustedKeySpecs: string[];
  revokedKeyIds: string[];
  cliVersion?: string;
  runnerVersion?: string;
  profileSchemaVersion?: number;
  now?: string;
}

function parseArgs(argv: string[]): ParsedArgs {
  const parsed: ParsedArgs = {
    trustedKeySpecs: [],
    revokedKeyIds: [],
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    const next = argv[index + 1];
    switch (arg) {
      case "--manifest":
        parsed.manifestPath = requireValue(arg, next);
        index += 1;
        break;
      case "--signature":
        parsed.signaturePath = requireValue(arg, next);
        index += 1;
        break;
      case "--trusted-key":
        parsed.trustedKeySpecs.push(requireValue(arg, next));
        index += 1;
        break;
      case "--revoked-key-id":
        parsed.revokedKeyIds.push(requireValue(arg, next));
        index += 1;
        break;
      case "--cli-version":
        parsed.cliVersion = requireValue(arg, next);
        index += 1;
        break;
      case "--runner-version":
        parsed.runnerVersion = requireValue(arg, next);
        index += 1;
        break;
      case "--profile-schema-version":
        parsed.profileSchemaVersion = Number.parseInt(
          requireValue(arg, next),
          10,
        );
        index += 1;
        break;
      case "--now":
        parsed.now = requireValue(arg, next);
        index += 1;
        break;
      default:
        throw new Error(`Unknown argument: ${arg}`);
    }
  }

  return parsed;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv.slice(2));
  if (!args.manifestPath) {
    throw new Error("--manifest is required");
  }

  const manifest = validateReleaseManifest(
    JSON.parse(await readFile(args.manifestPath, "utf8")),
  );

  if (args.cliVersion || args.runnerVersion || args.profileSchemaVersion) {
    assertManifestCompatible({
      manifest,
      cliVersion: args.cliVersion ?? manifest.components.cli.version,
      runnerVersion: args.runnerVersion,
      profileSchemaVersion: args.profileSchemaVersion,
    });
  }

  if (args.signaturePath || args.trustedKeySpecs.length > 0) {
    if (!args.signaturePath) {
      throw new Error("--signature is required when --trusted-key is provided");
    }
    const signature = validateReleaseManifestSignature(
      JSON.parse(await readFile(args.signaturePath, "utf8")),
    );
    const trustedKeys = await Promise.all(
      args.trustedKeySpecs.map(parseTrustedKeySpec),
    );
    const result = verifyReleaseManifest({
      manifest,
      signature,
      trustedKeys,
      revokedKeyIds: args.revokedKeyIds,
      now: args.now,
    });
    console.log(
      `Verified ThinkWork release manifest ${result.manifestSha256} with key ${result.keyId}`,
    );
    return;
  }

  console.log(
    `Validated ThinkWork release manifest ${manifest.release.version} without signature verification`,
  );
}

async function parseTrustedKeySpec(spec: string): Promise<TrustedReleaseKey> {
  const parts = Object.fromEntries(
    spec.split(",").map((part) => {
      const index = part.indexOf("=");
      if (index === -1) {
        throw new Error(`Invalid trusted-key segment: ${part}`);
      }
      return [part.slice(0, index), part.slice(index + 1)];
    }),
  );
  const keyId = parts.keyId;
  const pathValue = parts.path;
  if (!keyId || !pathValue) {
    throw new Error(`Trusted key spec must include keyId and path: ${spec}`);
  }
  return {
    keyId,
    publicKeyPem: await readFile(pathValue, "utf8"),
    notBefore: parts.notBefore,
    expiresAt: parts.expiresAt,
  };
}

function requireValue(flag: string, value: string | undefined): string {
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value`);
  }
  return value;
}

const modulePath = fileURLToPath(import.meta.url);
if (process.argv[1] && path.resolve(process.argv[1]) === modulePath) {
  main().catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    console.error(message);
    process.exit(1);
  });
}
