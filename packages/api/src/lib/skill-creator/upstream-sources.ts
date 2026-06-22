import { createHash } from "node:crypto";

export const UPSTREAM_SKILL_CREATOR_SOURCE = {
  owner: "anthropics",
  repo: "skills",
  branch: "main",
  sourcePath: "skills/skill-creator",
  repositoryUrl: "https://github.com/anthropics/skills",
  sourceUrl:
    "https://github.com/anthropics/skills/tree/main/skills/skill-creator",
  license: "Apache-2.0",
} as const;

export interface UpstreamSkillCreatorFile {
  path: string;
  sha: string;
  size: number;
  sha256: string;
}

export interface UpstreamSkillCreatorProvenance {
  source: typeof UPSTREAM_SKILL_CREATOR_SOURCE;
  commit: string;
  fetchedAt: string;
  contentSha256: string;
  files: UpstreamSkillCreatorFile[];
}

export function computeSkillCreatorContentDigest(
  files: Array<Pick<UpstreamSkillCreatorFile, "path" | "sha256">>,
): string {
  const hash = createHash("sha256");
  for (const file of [...files].sort((a, b) => a.path.localeCompare(b.path))) {
    hash.update(file.path);
    hash.update("\0");
    hash.update(file.sha256);
    hash.update("\0");
  }
  return hash.digest("hex");
}

export function isUpstreamSkillCreatorProvenance(
  value: unknown,
): value is UpstreamSkillCreatorProvenance {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return false;
  }
  const record = value as Partial<UpstreamSkillCreatorProvenance>;
  if (
    !record.source ||
    record.source.repositoryUrl !==
      UPSTREAM_SKILL_CREATOR_SOURCE.repositoryUrl ||
    record.source.sourcePath !== UPSTREAM_SKILL_CREATOR_SOURCE.sourcePath ||
    record.source.license !== UPSTREAM_SKILL_CREATOR_SOURCE.license
  ) {
    return false;
  }
  if (
    typeof record.commit !== "string" ||
    !/^[a-f0-9]{40}$/i.test(record.commit) ||
    typeof record.fetchedAt !== "string" ||
    Number.isNaN(Date.parse(record.fetchedAt)) ||
    typeof record.contentSha256 !== "string" ||
    !/^[a-f0-9]{64}$/i.test(record.contentSha256) ||
    !Array.isArray(record.files)
  ) {
    return false;
  }
  return record.files.every(
    (file) =>
      file &&
      typeof file.path === "string" &&
      file.path.length > 0 &&
      !file.path.startsWith("/") &&
      !file.path.split("/").includes("..") &&
      typeof file.sha === "string" &&
      /^[a-f0-9]{40}$/i.test(file.sha) &&
      typeof file.size === "number" &&
      Number.isInteger(file.size) &&
      file.size >= 0 &&
      typeof file.sha256 === "string" &&
      /^[a-f0-9]{64}$/i.test(file.sha256),
  );
}
