#!/usr/bin/env tsx
/**
 * Reads all skill.yaml files in the catalog and outputs index.json to stdout.
 */

import { readdirSync, readFileSync, statSync } from "fs";
import { join, dirname } from "path";
import { fileURLToPath } from "url";

const __dirname = dirname(fileURLToPath(import.meta.url));
const catalogRoot = join(__dirname, "..");

// Minimal YAML parser — skill.yaml files are flat key-value + one list/map level
function parseSkillYaml(content: string) {
  const result: Record<string, unknown> = {};
  let currentKey = "";
  let currentType: "list" | "map" | "" = "";
  const lines = content.split("\n");

  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    if (line.trim() === "" || line.trim().startsWith("#")) continue;

    // Indented list item: "  - value"
    const listMatch = line.match(/^\s+-\s+(.+)$/);
    if (listMatch && currentKey && currentType === "list") {
      const arr = result[currentKey] as string[];
      arr.push(listMatch[1].trim());
      continue;
    }

    // Indented map entry: "  KEY: value"
    const mapMatch = line.match(/^\s+(\w[\w_]*)\s*:\s*(.+)$/);
    if (mapMatch && currentKey && currentType === "map") {
      const map = result[currentKey] as Record<string, string>;
      let val = mapMatch[2].trim();
      if (val.startsWith('"') && val.endsWith('"')) val = val.slice(1, -1);
      map[mapMatch[1]] = val;
      continue;
    }

    const kvMatch = line.match(/^(\w[\w_]*)\s*:\s*(.*)$/);
    if (kvMatch) {
      const [, key, rawValue] = kvMatch;
      let value: unknown = rawValue.trim();

      // Handle arrays on same line: [a, b, c]
      if (typeof value === "string" && value.startsWith("[") && value.endsWith("]")) {
        value = value
          .slice(1, -1)
          .split(",")
          .map((s) => s.trim());
        result[key] = value;
        currentKey = "";
        currentType = "";
        continue;
      }

      // Handle quoted strings
      if (typeof value === "string" && value.startsWith('"') && value.endsWith('"')) {
        value = value.slice(1, -1);
      }

      // Empty value means list or map follows — peek ahead to determine which
      if (value === "") {
        const nextLine = lines[i + 1] || "";
        if (nextLine.match(/^\s+-\s+/)) {
          result[key] = [];
          currentType = "list";
        } else {
          result[key] = {};
          currentType = "map";
        }
        currentKey = key;
        continue;
      }

      result[key] = value;
      currentKey = key;
      currentType = "";
    }
  }

  return result;
}

const entries = readdirSync(catalogRoot).filter((name) => {
  if (name === "scripts" || name === "node_modules" || name.startsWith(".")) return false;
  const fullPath = join(catalogRoot, name);
  return statSync(fullPath).isDirectory() && statSync(join(fullPath, "skill.yaml")).isFile();
});

const index = entries.map((dir) => {
  const yamlContent = readFileSync(join(catalogRoot, dir, "skill.yaml"), "utf-8");
  return parseSkillYaml(yamlContent);
});

process.stdout.write(JSON.stringify(index, null, 2) + "\n");
