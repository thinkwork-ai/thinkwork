import { VERSION } from "../../version.js";

export interface EnterpriseReleasePin {
  version: string;
  manifestUrl: string;
  manifestSha256?: string;
  terraformModuleVersion: string;
}

export function resolveEnterpriseReleasePin(options: {
  releaseVersion?: string;
  manifestUrl?: string;
  manifestSha256?: string;
  terraformModuleVersion?: string;
}): EnterpriseReleasePin {
  const version = options.releaseVersion ?? `v${VERSION}`;
  const normalizedVersion = normalizeVersion(version);
  return {
    version,
    manifestUrl:
      options.manifestUrl ??
      `https://github.com/thinkwork-ai/thinkwork/releases/download/${version}/thinkwork-release.json`,
    manifestSha256: options.manifestSha256,
    terraformModuleVersion: options.terraformModuleVersion ?? normalizedVersion,
  };
}

function normalizeVersion(version: string): string {
  return version.startsWith("v") ? version.slice(1) : version;
}
