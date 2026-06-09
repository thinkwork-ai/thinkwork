import { getSpacesDeploymentProfileSnapshot } from "@/lib/deployment-profile";
import type { TokenStorage } from "@/lib/token-storage";

export const AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY =
  "thinkwork.authDeploymentProfileSha256.v1";

export function currentDeploymentProfileSha(): string | null {
  return getSpacesDeploymentProfileSnapshot().profileSha256;
}

export function ensureAuthStorageMatchesDeploymentProfile(
  storage: TokenStorage,
): boolean {
  const currentSha = currentDeploymentProfileSha();
  if (!currentSha) {
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return false;
  }

  const storedSha = storage.getItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
  if (storedSha && storedSha !== currentSha) {
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return false;
  }

  return true;
}

export function markAuthStorageDeploymentProfile(storage: TokenStorage): void {
  const currentSha = currentDeploymentProfileSha();
  if (!currentSha) {
    storage.removeItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY);
    return;
  }
  storage.setItem(AUTH_DEPLOYMENT_PROFILE_SHA_STORAGE_KEY, currentSha);
}
