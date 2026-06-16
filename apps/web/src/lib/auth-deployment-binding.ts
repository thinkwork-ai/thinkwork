import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import type { TokenStorage } from "@/lib/token-storage";

export const AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY =
  "thinkwork.authDeploymentProfileSha256.v1";
export const AUTH_DEPLOYMENT_BINDING_STORAGE_KEY =
  "thinkwork.authDeploymentBinding.v2";

export function currentDeploymentProfileSha(): string | null {
  return getSpacesDeploymentProfileSnapshot().profileSha256;
}

export function currentAuthDeploymentBinding(): string | null {
  const snapshot = getSpacesDeploymentProfileSnapshot();
  const profile = snapshot.profile;
  if (!profile) return null;

  return stableFingerprint({
    deploymentId: profile.deploymentId,
    spacesUrl: profile.spacesUrl,
    cognitoDomain: profile.cognitoDomain,
    cognitoUserPoolId: profile.cognitoUserPoolId,
    cognitoClientId: profile.cognitoClientId,
  });
}

export function ensureAuthStorageMatchesDeploymentProfile(
  storage: TokenStorage,
): boolean {
  const snapshot = getSpacesDeploymentProfileSnapshot();
  const profile = snapshot.profile;
  const currentBinding = profile
    ? stableFingerprint({
        deploymentId: profile.deploymentId,
        spacesUrl: profile.spacesUrl,
        cognitoDomain: profile.cognitoDomain,
        cognitoUserPoolId: profile.cognitoUserPoolId,
        cognitoClientId: profile.cognitoClientId,
      })
    : null;
  if (!currentBinding || !profile) {
    storage.removeItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY);
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return false;
  }

  const storedBinding = storage.getItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY);
  if (storedBinding) {
    if (storedBinding === currentBinding) return true;
    storage.removeItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY);
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return false;
  }

  // v1 stored the entire deployment profile digest. That digest included
  // release metadata such as issuedAt, so normal customer deploys invalidated
  // otherwise-valid sessions. If only the legacy key exists and the current
  // token still belongs to the current auth boundary, migrate in place instead
  // of forcing a logout.
  const legacySha = storage.getItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
  if (legacySha) {
    if (tokenMatchesCurrentAuthBoundary(storage, profile)) {
      storage.setItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY, currentBinding);
      return true;
    }

    storage.removeItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY);
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return false;
  }

  return true;
}

export function markAuthStorageDeploymentProfile(storage: TokenStorage): void {
  const currentBinding = currentAuthDeploymentBinding();
  if (!currentBinding) {
    storage.removeItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY);
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return;
  }
  storage.setItem(AUTH_DEPLOYMENT_BINDING_STORAGE_KEY, currentBinding);
  storage.setItem(
    AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY,
    currentDeploymentProfileSha() ?? currentBinding,
  );
}

function stableFingerprint(values: Record<string, string>): string {
  const canonical = JSON.stringify(
    Object.keys(values)
      .sort()
      .map((key) => [key, values[key]]),
  );
  let hash = 0x811c9dc5;
  for (let i = 0; i < canonical.length; i += 1) {
    hash ^= canonical.charCodeAt(i);
    hash = Math.imul(hash, 0x01000193);
  }
  return `auth-v2:${(hash >>> 0).toString(16).padStart(8, "0")}`;
}

function tokenMatchesCurrentAuthBoundary(
  storage: TokenStorage,
  profile: NonNullable<
    ReturnType<typeof getSpacesDeploymentProfileSnapshot>["profile"]
  >,
): boolean {
  const prefix = `CognitoIdentityServiceProvider.${profile.cognitoClientId}`;
  const lastUser = storage.getItem(`${prefix}.LastAuthUser`);
  const idToken = lastUser
    ? storage.getItem(`${prefix}.${lastUser}.idToken`)
    : storage.getItem("idToken");
  const payload = idToken ? decodeJwtPayload(idToken) : null;
  if (!payload) return false;

  return (
    payload.iss ===
      `https://cognito-idp.${profile.region}.amazonaws.com/${profile.cognitoUserPoolId}` &&
    payload.aud === profile.cognitoClientId
  );
}

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  const [, payload] = token.split(".");
  if (!payload) return null;
  try {
    const normalized = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    return JSON.parse(atob(padded)) as Record<string, unknown>;
  } catch {
    return null;
  }
}
