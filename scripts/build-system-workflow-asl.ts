import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { listSystemWorkflowDefinitions } from "../packages/api/src/lib/system-workflows/registry.js";
import { buildSystemWorkflowAsl } from "../packages/api/src/lib/system-workflows/asl.js";

const outDir = join(
  process.cwd(),
  "terraform/modules/app/system-workflows-stepfunctions/asl",
);

mkdirSync(outDir, { recursive: true });

for (const definition of listSystemWorkflowDefinitions()) {
  const filename = `${definition.id}-standard.asl.json`;
  writeFileSync(
    join(outDir, filename),
    `${JSON.stringify(buildSystemWorkflowAsl(definition), null, 2)}\n`,
  );
}
