import { mkdir, rm, writeFile } from "node:fs/promises";
import { dirname, join, resolve } from "node:path";
import type { VerifiedBundle } from "./bundle-fetcher";

export interface MaterializeBundleInput {
  rootDir: string;
  runId: string;
  bundle: VerifiedBundle;
}

export interface MaterializedProject {
  projectDir: string;
  bundleVersion: string;
  bundleDigest: string;
  writtenFiles: string[];
}

function assertSafeRelativePath(path: string): void {
  if (path.startsWith("/") || path.includes("..")) {
    throw new Error(`Unsafe bundle file path: ${path}`);
  }
}

export async function materializeBundle(
  input: MaterializeBundleInput,
): Promise<MaterializedProject> {
  const projectDir = resolve(
    input.rootDir,
    input.runId,
    input.bundle.manifest.bundleVersion,
  );
  await rm(projectDir, { force: true, recursive: true });
  await mkdir(projectDir, { recursive: true });

  const writtenFiles: string[] = [];
  for (const file of input.bundle.manifest.meltanoProject.files) {
    assertSafeRelativePath(file.path);
    const contents = input.bundle.files[file.path];
    if (contents === undefined) {
      throw new Error(`Bundle file missing: ${file.path}`);
    }
    const absolutePath = join(projectDir, file.path);
    await mkdir(dirname(absolutePath), { recursive: true });
    await writeFile(absolutePath, contents, "utf8");
    writtenFiles.push(file.path);
  }

  return {
    projectDir,
    bundleVersion: input.bundle.manifest.bundleVersion,
    bundleDigest: input.bundle.digest,
    writtenFiles,
  };
}
