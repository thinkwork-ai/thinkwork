import {
  ListObjectsV2Command,
  PutObjectCommand,
  type S3Client,
} from "@aws-sdk/client-s3";
import { readdir, readFile, stat } from "node:fs/promises";
import { dirname, join, relative, sep } from "node:path";
import { fileURLToPath } from "node:url";
import { isBuiltinToolSlug } from "./builtin-tool-slugs.js";

export type CatalogSeedResult = {
  ok: true;
  imported_slugs: string[];
  skipped_slugs: string[];
};

export type CatalogSeedOptions = {
  s3: S3Client;
  bucket: string;
  tenantSlug: string;
  catalogRoot?: string;
};

type SourceSkill = {
  slug: string;
  files: Array<{ relativePath: string; content: Buffer }>;
  hasWiringMd: boolean;
};

export async function seedTenantSkillCatalog(
  options: CatalogSeedOptions,
): Promise<CatalogSeedResult> {
  const sourceRoot = options.catalogRoot ?? (await resolveCatalogRoot());
  const sourceSkills = await readSourceSkills(sourceRoot);
  const existingSlugs = await listExistingCatalogSlugs(options);
  const imported_slugs: string[] = [];
  const skipped_slugs: string[] = [];

  for (const skill of sourceSkills) {
    if (isBuiltinToolSlug(skill.slug) || existingSlugs.has(skill.slug)) {
      skipped_slugs.push(skill.slug);
      continue;
    }

    for (const file of skill.files) {
      await putCatalogFile(
        options,
        skill.slug,
        file.relativePath,
        file.content,
      );
    }
    if (!skill.hasWiringMd) {
      await putCatalogFile(
        options,
        skill.slug,
        "WIRING.md",
        Buffer.from(renderPlaceholderWiring(skill.slug), "utf8"),
      );
    }
    imported_slugs.push(skill.slug);
  }

  return {
    ok: true,
    imported_slugs: imported_slugs.sort(),
    skipped_slugs: skipped_slugs.sort(),
  };
}

export function renderPlaceholderWiring(slug: string): string {
  return `# Wiring suggestions for ${slug}

## Always-on
Placeholder wiring imported from the legacy skill catalog. Edit this suggestion in the catalog before installing it into production workspaces.

\`\`\`context-md
| Always-on ${slug} | . | skills/${slug}/SKILL.md |
\`\`\`
`;
}

async function readSourceSkills(root: string): Promise<SourceSkill[]> {
  const entries = await readdir(root, { withFileTypes: true });
  const skills: SourceSkill[] = [];
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const slug = entry.name;
    const dir = join(root, slug);
    if (!(await fileExists(join(dir, "SKILL.md")))) continue;
    const files = await readFilesRecursively(dir);
    skills.push({
      slug,
      files,
      hasWiringMd: files.some((file) => file.relativePath === "WIRING.md"),
    });
  }
  return skills.sort((a, b) => a.slug.localeCompare(b.slug));
}

async function readFilesRecursively(
  dir: string,
  base = dir,
): Promise<Array<{ relativePath: string; content: Buffer }>> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: Array<{ relativePath: string; content: Buffer }> = [];
  for (const entry of entries) {
    const fullPath = join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await readFilesRecursively(fullPath, base)));
      continue;
    }
    if (!entry.isFile()) continue;
    files.push({
      relativePath: relative(base, fullPath).split(sep).join("/"),
      content: await readFile(fullPath),
    });
  }
  return files.sort((a, b) => a.relativePath.localeCompare(b.relativePath));
}

async function listExistingCatalogSlugs(
  options: CatalogSeedOptions,
): Promise<Set<string>> {
  const prefix = `tenants/${options.tenantSlug}/skill-catalog/`;
  const slugs = new Set<string>();
  let continuationToken: string | undefined;
  do {
    const response = await options.s3.send(
      new ListObjectsV2Command({
        Bucket: options.bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }),
    );
    for (const object of response.Contents ?? []) {
      if (!object.Key?.startsWith(prefix)) continue;
      const slug = object.Key.slice(prefix.length).split("/")[0];
      if (slug) slugs.add(slug);
    }
    continuationToken = response.IsTruncated
      ? response.NextContinuationToken
      : undefined;
  } while (continuationToken);
  return slugs;
}

async function putCatalogFile(
  options: CatalogSeedOptions,
  slug: string,
  path: string,
  content: Buffer,
): Promise<void> {
  await options.s3.send(
    new PutObjectCommand({
      Bucket: options.bucket,
      Key: `tenants/${options.tenantSlug}/skill-catalog/${slug}/${path}`,
      Body: content,
      ContentType: "text/plain; charset=utf-8",
    }),
  );
}

async function resolveCatalogRoot(): Promise<string> {
  const here = dirname(fileURLToPath(import.meta.url));
  const candidates = [
    process.env.THINKWORK_SKILL_CATALOG_ROOT,
    join(here, "skill-catalog"),
    join(process.cwd(), "packages/skill-catalog"),
    join(process.cwd(), "../skill-catalog"),
  ].filter((candidate): candidate is string => Boolean(candidate));

  for (const candidate of candidates) {
    if (await directoryExists(candidate)) return candidate;
  }
  throw new Error("Could not locate bundled skill catalog assets");
}

async function fileExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isFile();
  } catch {
    return false;
  }
}

async function directoryExists(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}
