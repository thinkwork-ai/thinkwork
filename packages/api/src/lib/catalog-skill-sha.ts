import { createHash } from "node:crypto";

export interface CatalogSkillShaFile {
  relativePath: string;
  content: string | Uint8Array;
}

export interface CatalogSkillPathFile {
  path: string;
  content: string | Uint8Array;
}

export function sha256Hex(content: string | Uint8Array): string {
  return createHash("sha256").update(content).digest("hex");
}

export function computeCatalogSkillSha(files: CatalogSkillShaFile[]): string {
  const deterministic = [...files]
    .sort((a, b) =>
      a.relativePath < b.relativePath
        ? -1
        : a.relativePath > b.relativePath
          ? 1
          : 0,
    )
    .map((file) => `${file.relativePath}\0${sha256Hex(file.content)}\n`)
    .join("");
  return sha256Hex(deterministic);
}

export function computeCatalogSkillShaBySlug(
  files: CatalogSkillPathFile[],
): Map<string, string> {
  const grouped = new Map<string, CatalogSkillShaFile[]>();
  for (const file of files) {
    const cleanPath = file.path.replace(/^\/+/, "");
    const [slug, ...rest] = cleanPath.split("/");
    if (!slug) continue;
    const relativePath = rest.join("/");
    const current = grouped.get(slug) ?? [];
    if (relativePath) {
      current.push({ relativePath, content: file.content });
    }
    grouped.set(slug, current);
  }

  const out = new Map<string, string>();
  for (const [slug, skillFiles] of grouped) {
    out.set(slug, computeCatalogSkillSha(skillFiles));
  }
  return out;
}
