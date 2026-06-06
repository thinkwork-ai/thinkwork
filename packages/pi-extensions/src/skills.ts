import type { ToolDefinition } from "@earendil-works/pi-coding-agent";
import type {
  ChildModelCaller,
  ModelRoutingDecision,
  ModelRoutingPolicy,
  ModelRoutingRoute,
} from "@thinkwork/pi-runtime-core";
import { Type } from "typebox";

import {
  defineExtension,
  type ThinkworkExtension,
} from "./define-extension.js";

export interface WorkspaceSkill {
  slug: string;
  name: string;
  description: string;
  skillPath: string;
  content: string;
}

export interface SkillsExtensionOptions {
  skills: WorkspaceSkill[];
  modelRoutingPolicy?: ModelRoutingPolicy;
  approvedModelIds?: string[];
  childModelCaller?: ChildModelCaller;
}

class ModelRoutingPolicyError extends Error {
  constructor(
    public readonly code:
      | "MODEL_ROUTE_UNAPPROVED"
      | "MODEL_ROUTE_CALLER_MISSING"
      | "MODEL_ROUTE_CHILD_FAILED",
    message: string,
    public readonly route?: ModelRoutingRoute,
  ) {
    super(message);
    this.name = "ModelRoutingPolicyError";
  }
}

function routeMatches(
  route: ModelRoutingRoute,
  toolName: string,
  match: Record<string, string>,
): boolean {
  if (route.tool !== toolName) return false;
  return Object.entries(route.match).every(
    ([key, value]) => match[key] === value,
  );
}

function findModelRoutingDecision(
  policy: ModelRoutingPolicy,
  input: { toolName: string; match: Record<string, string> },
): ModelRoutingDecision | null {
  const candidates = policy.routes.filter((route) =>
    routeMatches(route, input.toolName, input.match),
  );
  if (!candidates.length) return null;
  const route = [...candidates].sort((left, right) => {
    const specificity =
      Object.keys(right.match).length - Object.keys(left.match).length;
    if (specificity !== 0) return specificity;
    return (right.precedence ?? 0) - (left.precedence ?? 0);
  })[0]!;
  return {
    route,
    ruleSource: {
      ...(route.sourcePath ? { path: route.sourcePath } : {}),
      ...(route.sourceOwner ? { owner: route.sourceOwner } : {}),
      ...(route.precedence !== undefined
        ? { precedence: route.precedence }
        : {}),
    },
  };
}

function assertModelRouteApproved(input: {
  decision: ModelRoutingDecision;
  approvedModelIds: readonly string[];
}): void {
  if (input.approvedModelIds.includes(input.decision.route.model)) return;
  throw new ModelRoutingPolicyError(
    "MODEL_ROUTE_UNAPPROVED",
    `TOOLS.md routed ${input.decision.route.tool} to model "${input.decision.route.model}", but that model is not approved for this user.`,
    input.decision.route,
  );
}

export function formatWorkspaceSkills(
  skills: WorkspaceSkill[],
  emphasizedSlugs?: Iterable<string>,
): string {
  if (!skills.length) return "";
  const emphasized = new Set(emphasizedSlugs ?? []);
  const pinnedPresent = skills.filter((skill) => emphasized.has(skill.slug));
  const lines = [
    "Workspace skills are available from the copied local workspace tree.",
    "Use the workspace_skill tool to read the full instructions before applying one.",
    "",
    ...skills.map(
      (skill) =>
        `- ${skill.slug}${emphasized.has(skill.slug) ? " (pinned)" : ""}: ${
          skill.description || skill.name
        }`,
    ),
  ];
  if (pinnedPresent.length > 0) {
    lines.push(
      "",
      `The user explicitly invoked these skills for this turn: ${pinnedPresent
        .map((skill) => skill.slug)
        .join(
          ", ",
        )}. Prioritize them — read their instructions with the workspace_skill ` +
        "tool and apply them unless they are clearly irrelevant to the request. " +
        "Your other skills remain available.",
    );
  }
  return lines.join("\n");
}

export function createSkillsExtension(
  options: SkillsExtensionOptions,
): ThinkworkExtension {
  const skills = options.skills;
  const modelRoutingPolicy = options.modelRoutingPolicy ?? { routes: [] };
  const approvedModelIds = options.approvedModelIds ?? [];
  const childModelCaller = options.childModelCaller;
  return defineExtension({
    name: "thinkwork-skills",
    toolNames: skills.length > 0 ? ["workspace_skill"] : [],
    register(pi) {
      if (!skills.length) return;

      const bySlug = new Map(skills.map((skill) => [skill.slug, skill]));
      const tool: ToolDefinition = {
        name: "workspace_skill",
        label: "Workspace Skill",
        description:
          "Read a skill installed in this agent's copied workspace/skills folder before using its instructions.",
        parameters: Type.Object({
          slug: Type.String({ description: "Workspace skill slug." }),
        }),
        executionMode: "sequential",
        async execute(_toolCallId, params) {
          const slug = String((params as { slug?: unknown }).slug || "").trim();
          const skill = bySlug.get(slug);
          if (!skill) {
            throw new Error(
              `Unknown workspace skill '${slug}'. Available: ${skills
                .map((item) => item.slug)
                .join(", ")}`,
            );
          }
          const decision = findModelRoutingDecision(modelRoutingPolicy, {
            toolName: "workspace_skill",
            match: { slug: skill.slug },
          });
          if (decision) {
            assertModelRouteApproved({ decision, approvedModelIds });
            if (!childModelCaller) {
              throw new ModelRoutingPolicyError(
                "MODEL_ROUTE_CALLER_MISSING",
                `TOOLS.md routed workspace_skill to model "${decision.route.model}", but no child model caller is configured.`,
                decision.route,
              );
            }
            const startedAt = Date.now();
            const childResult = await childModelCaller({
              modelId: decision.route.model,
              systemPrompt:
                "You are a ThinkWork skill execution helper. Apply the provided workspace skill instructions to this tool call and return the useful result only.",
              prompt: [
                `Workspace skill: ${skill.name} (${skill.slug})`,
                `Skill path: ${skill.skillPath}`,
                "",
                "Tool parameters:",
                JSON.stringify(params ?? {}, null, 2),
                "",
                "Skill instructions:",
                skill.content,
              ].join("\n"),
              metadata: {
                toolName: "workspace_skill",
                slug: skill.slug,
                sourcePath: decision.ruleSource.path,
                sourceOwner: decision.ruleSource.owner,
              },
            });
            const durationMs = Date.now() - startedAt;
            return {
              content: [{ type: "text", text: childResult.text }],
              details: {
                slug: skill.slug,
                name: skill.name,
                description: skill.description,
                path: skill.skillPath,
                modelRouting: {
                  toolName: "workspace_skill",
                  match: { slug: skill.slug },
                  model: decision.route.model,
                  ruleSource: decision.ruleSource,
                  status: "completed",
                  durationMs,
                  ...(childResult.stopReason
                    ? { stopReason: childResult.stopReason }
                    : {}),
                  ...(childResult.usage
                    ? {
                        inputTokens: childResult.usage.inputTokens,
                        outputTokens: childResult.usage.outputTokens,
                        cachedReadTokens: childResult.usage.cachedReadTokens,
                        cachedWriteTokens: childResult.usage.cachedWriteTokens,
                        totalTokens: childResult.usage.totalTokens,
                      }
                    : {}),
                },
              },
            };
          }
          return {
            content: [{ type: "text", text: skill.content }],
            details: {
              slug: skill.slug,
              name: skill.name,
              description: skill.description,
              path: skill.skillPath,
            },
          };
        },
      };

      pi.registerTool(tool);
    },
  });
}
