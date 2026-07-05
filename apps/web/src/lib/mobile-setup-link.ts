import QRCode from "./qr-code/vendor/QRCode";
import type { DeploymentProfile } from "@thinkwork/deployment-profile";

export const MOBILE_DEPLOYMENT_PROFILE_SCHEME = "thinkwork://deployment-profile";

export function encodeDeploymentProfileForMobile(
  profile: DeploymentProfile,
): string {
  return encodeBase64Url(JSON.stringify(profile));
}

export function buildMobileDeploymentProfileLink(
  profile: DeploymentProfile,
): string {
  const params = new URLSearchParams({
    profile: encodeDeploymentProfileForMobile(profile),
  });
  return `${MOBILE_DEPLOYMENT_PROFILE_SCHEME}?${params.toString()}`;
}

export function createQrMatrix(value: string): boolean[][] {
  const qr = new QRCode(-1, 1);
  qr.addData(value);
  qr.make();
  return qr.modules;
}

function encodeBase64Url(value: string): string {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) {
    binary += String.fromCharCode(byte);
  }
  return btoa(binary)
    .replace(/\+/g, "-")
    .replace(/\//g, "_")
    .replace(/=+$/, "");
}
