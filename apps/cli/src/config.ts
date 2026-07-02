/**
 * Stage and component validation + configuration resolution.
 *
 * Stages are validated against a known set to prevent typos like "priduction".
 * Components map to the three-tier Terraform directory structure.
 */

export const VALID_COMPONENTS = ["foundation", "data", "app", "all"] as const;
export type Component = (typeof VALID_COMPONENTS)[number];

export const PROD_LIKE_STAGES = ["main", "prod", "production", "staging"];

/**
 * Lambda function names cap at 64 characters. API handlers are named
 * `thinkwork-<stage>-api-<handler>` (15 fixed characters of scaffolding) and
 * the longest platform handler is `knowledge-graph-observations-ingest` (35),
 * leaving 14 for the stage. Dev (3 chars) never sees the wall; a 16-character
 * stage hits it 437 resources into its first apply (harness cycle-6 ledger
 * entry). `bedrock-singletons`-style fixture test pins this against the
 * actual handler list.
 */
export const MAX_STAGE_NAME_LENGTH = 14;

/**
 * Validates a stage name. Stages must be lowercase alphanumeric + hyphens,
 * 2-14 characters. This catches typos while allowing custom stage names.
 */
export function validateStage(stage: string): {
  valid: boolean;
  error?: string;
} {
  if (!stage) {
    return { valid: false, error: "Stage name is required." };
  }
  if (!/^[a-z][a-z0-9-]{1,29}$/.test(stage)) {
    return {
      valid: false,
      error: `Invalid stage name "${stage}". Must be lowercase alphanumeric + hyphens, 2-30 characters, starting with a letter.`,
    };
  }
  if (stage.length > MAX_STAGE_NAME_LENGTH) {
    return {
      valid: false,
      error:
        `Stage name "${stage}" is ${stage.length} characters — the maximum is ${MAX_STAGE_NAME_LENGTH}. ` +
        `Longer stages push Lambda function names (thinkwork-<stage>-api-<handler>) past AWS's 64-character cap.`,
    };
  }
  return { valid: true };
}

/**
 * Validates a component name.
 */
export function validateComponent(component: string): {
  valid: boolean;
  error?: string;
} {
  if (!VALID_COMPONENTS.includes(component as Component)) {
    return {
      valid: false,
      error: `Invalid component "${component}". Must be one of: ${VALID_COMPONENTS.join(", ")}`,
    };
  }
  return { valid: true };
}

/**
 * Returns true if the stage name looks production-like and requires
 * explicit confirmation for destructive operations.
 */
export function isProdLike(stage: string): boolean {
  return PROD_LIKE_STAGES.includes(stage);
}

/**
 * Returns the list of tier directories to operate on for a given component.
 * "all" expands to foundation → data → app in dependency order.
 */
export function expandComponent(component: Component): string[] {
  if (component === "all") {
    return ["foundation", "data", "app"];
  }
  return [component];
}
