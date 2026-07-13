/**
 * Capability broker credential-resolution seam (THINK-280 U5).
 *
 * The broker holds ONLY vault references (secret-manager ids) in its session
 * and authorization state — never secret material. This module is the single
 * point where a vault reference is exchanged for the real secret payload, and
 * it runs INSIDE the broker boundary, immediately before adapter dispatch and
 * only once an installed adapter has been resolved.
 *
 * Invariants:
 *   - The adapter never sees a vault reference and never resolves one itself;
 *     it receives already-resolved {@link ResolvedCredential} handles.
 *   - A resolution failure is a typed `failed` outcome (credential category =
 *     `readiness_blocked`: the binding's credential could not be made ready) and
 *     the broker does NOT dispatch.
 *   - Resolved secret material never enters the evidence row: the broker digests
 *     the request input and the (projected) result, never the credential map,
 *     and error messages here never echo the reference or the secret.
 */

import type { BrokerErrorCategory } from "@thinkwork/capability-contracts";

/**
 * A resolved credential payload — the decoded Secrets Manager JSON object for
 * one logical credential (e.g. `{ token: "…" }`). Keyed in the resolution by
 * the SAME logical name the binding used for its vault reference.
 */
export type ResolvedCredential = Readonly<Record<string, unknown>>;

export type CredentialResolution =
  | { ok: true; credentials: Record<string, ResolvedCredential> }
  | { ok: false; category: BrokerErrorCategory; message: string };

export interface CredentialResolver {
  /**
   * Resolve a map of `{ logicalName: vaultReference }` to a map of
   * `{ logicalName: resolvedPayload }`. Fail-closed: any missing, empty, or
   * unreadable reference fails the WHOLE resolution (no partial credentials).
   */
  resolveCredentialRefs(
    refs: Record<string, string>,
  ): Promise<CredentialResolution>;
}

/**
 * The broker's DEFAULT resolver: a no-op that does NOT read the vault. It
 * always succeeds with an EMPTY credential map, so the pure broker core needs
 * no secret access and dispatch still proceeds. An adapter that actually needs
 * a credential then fails closed at the point of use (it finds no handle). The
 * production handler injects the SecretsManager-backed resolver; tests inject
 * fakes. The broker is inert in production regardless (the authorization loader
 * denies every request until a later unit wires it).
 */
export function createPassthroughCredentialResolver(): CredentialResolver {
  return {
    async resolveCredentialRefs() {
      return { ok: true, credentials: {} };
    },
  };
}

/** Read one Secrets Manager secret string by reference; null when absent. */
export type SecretValueGetter = (secretRef: string) => Promise<string | null>;

export interface SecretsManagerCredentialResolverOptions {
  /** Injection seam for tests. Defaults to a lazy SecretsManager GetSecretValue. */
  getSecretValue?: SecretValueGetter;
  region?: string;
}

/**
 * Secrets Manager-backed resolver. Each reference is read and JSON-parsed into
 * a payload object. Any failure collapses to a single typed `readiness_blocked`
 * outcome whose message never contains the reference or the secret, so a
 * resolution error cannot leak which vault entry or value was involved.
 */
export function createSecretsManagerCredentialResolver(
  opts: SecretsManagerCredentialResolverOptions = {},
): CredentialResolver {
  const getSecretValue =
    opts.getSecretValue ?? defaultGetSecretValue(opts.region);
  return {
    async resolveCredentialRefs(refs) {
      const credentials: Record<string, ResolvedCredential> = {};
      for (const [name, ref] of Object.entries(refs)) {
        if (typeof ref !== "string" || ref.trim().length === 0) {
          return credentialFailure();
        }
        let raw: string | null;
        try {
          raw = await getSecretValue(ref);
        } catch {
          return credentialFailure();
        }
        if (raw === null || raw.trim().length === 0) {
          return credentialFailure();
        }
        let parsed: unknown;
        try {
          parsed = JSON.parse(raw);
        } catch {
          return credentialFailure();
        }
        if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
          return credentialFailure();
        }
        credentials[name] = Object.freeze({
          ...(parsed as Record<string, unknown>),
        });
      }
      return { ok: true, credentials };
    },
  };
}

function credentialFailure(): CredentialResolution {
  return {
    ok: false,
    category: "readiness_blocked",
    // Deliberately generic: never name the reference or the secret value.
    message: "credential resolution failed",
  };
}

function defaultGetSecretValue(region?: string): SecretValueGetter {
  return async (secretRef: string) => {
    const { SecretsManagerClient, GetSecretValueCommand } =
      await import("@aws-sdk/client-secrets-manager");
    const client = new SecretsManagerClient({
      region: region || process.env.AWS_REGION || "us-east-1",
    });
    const result = await client.send(
      new GetSecretValueCommand({ SecretId: secretRef }),
    );
    return result.SecretString ?? null;
  };
}
