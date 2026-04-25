export function normalizeFolderPath(path: string): string {
  return path.split("/").filter(Boolean).join("/");
}

export function pathIsWithinFolder(path: string, folderPath: string): boolean {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return false;
  return path === folder || path.startsWith(`${folder}/`);
}

export function filesForFolderDelete(files: string[], folderPath: string): string[] {
  const folder = normalizeFolderPath(folderPath);
  if (!folder) return [];
  return files
    .filter((path) => path.startsWith(`${folder}/`))
    .sort((a, b) => a.localeCompare(b));
}
