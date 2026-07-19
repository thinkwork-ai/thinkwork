import { createHash } from "node:crypto";

export const GOVERNED_TOOL_TYPES = new Map([
  ["thinkwork_gateway", "agentcore_gateway"],
  ["browser", "agentcore_browser"],
  ["emit_document", "inline_function"],
  ["goal_complete", "inline_function"],
  ["submit_skill_draft", "inline_function"],
]);

export function canonicalJson(value) {
  if (Array.isArray(value)) {
    return `[${value.map(canonicalJson).join(",")}]`;
  }
  if (value && typeof value === "object") {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
      .join(",")}}`;
  }
  return JSON.stringify(value);
}

export function fingerprintGovernedHarnessTools(value) {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

export function selectHarnessEndpointsForRetention(
  endpoints,
  { activeEndpointName, endpointPrefix, legacyEndpointName },
) {
  const managed = endpoints.filter(
    (endpoint) =>
      endpoint.endpointName === legacyEndpointName ||
      endpoint.endpointName?.startsWith(endpointPrefix),
  );
  const rollbackEndpointName = managed
    .filter((endpoint) => endpoint.endpointName !== activeEndpointName)
    .sort((left, right) =>
      String(right.liveVersion ?? right.targetVersion ?? "").localeCompare(
        String(left.liveVersion ?? left.targetVersion ?? ""),
        undefined,
        { numeric: true },
      ),
    )[0]?.endpointName;
  const retainedEndpointNames = new Set(
    [activeEndpointName, rollbackEndpointName].filter(
      (value) => typeof value === "string",
    ),
  );
  return {
    rollbackEndpointName,
    retainedEndpointNames: [...retainedEndpointNames],
    deletedEndpointNames: managed
      .map((endpoint) => endpoint.endpointName)
      .filter(
        (endpointName) =>
          endpointName && !retainedEndpointNames.has(endpointName),
      ),
  };
}

/**
 * One canonical producer contract for both Harness reconciliation and
 * immutable-version readback. Keeping the complete inline schemas here makes
 * schema drift a deployment failure instead of re-attesting it into SSM.
 */
export function buildGovernedHarnessTools({ gatewayArn, providerArn }) {
  return [
    {
      type: "agentcore_gateway",
      name: "thinkwork_gateway",
      config: {
        agentCoreGateway: {
          gatewayArn,
          outboundAuth: {
            oauth: {
              providerArn,
              scopes: ["gateway:invoke"],
              customParameters: {
                subject_token_type: "urn:ietf:params:oauth:token-type:jwt",
              },
              grantType: "TOKEN_EXCHANGE",
            },
          },
        },
      },
    },
    {
      type: "agentcore_browser",
      name: "browser",
      config: { agentCoreBrowser: {} },
    },
    {
      type: "inline_function",
      name: "emit_document",
      config: {
        inlineFunction: {
          description:
            "Emit a durable ThinkWork HTML plate from markdown. Use genre report, plan, brief, or ideation. The platform compiles, validates, persists, and attaches it to the thread. On rejection, fix every diagnostic and call again with document_id when supplied.",
          inputSchema: {
            type: "object",
            properties: {
              genre: {
                type: "string",
                enum: ["report", "plan", "brief", "ideation"],
              },
              title: { type: "string" },
              abstract: { type: "string" },
              digest_markdown: {
                type: "string",
                description: "Complete markdown document body.",
              },
              status: { type: "string", enum: ["draft", "final"] },
              document_id: { type: "string" },
              space_id: { type: "string" },
            },
            required: ["genre", "title", "abstract", "digest_markdown"],
            additionalProperties: false,
          },
        },
      },
    },
    {
      type: "inline_function",
      name: "goal_complete",
      config: {
        inlineFunction: {
          description:
            "Mark the current ThinkWork-managed Goal mode objective complete. Call exactly once only after the objective is fully satisfied.",
          inputSchema: {
            type: "object",
            properties: {
              summary: {
                type: "string",
                description: "Concise user-facing completion summary.",
              },
              completion_notes: {
                type: "string",
                description: "Optional bounded completion details.",
              },
              verification_notes: {
                type: "array",
                items: { type: "string" },
                maxItems: 5,
                description: "Concrete checks proving completion.",
              },
            },
            required: ["summary"],
            additionalProperties: false,
          },
        },
      },
    },
    {
      type: "inline_function",
      name: "submit_skill_draft",
      config: {
        inlineFunction: {
          description:
            "Submit a complete Agent Skills draft to ThinkWork's governed review and trust queue. Available only during a trusted /skill-creator turn; this does not publish the skill.",
          inputSchema: {
            type: "object",
            properties: {
              skill_markdown: {
                type: "string",
                description:
                  "Complete SKILL.md including valid name and description frontmatter.",
              },
              supporting_files: {
                type: "array",
                maxItems: 20,
                items: {
                  type: "object",
                  properties: {
                    path: { type: "string" },
                    content: { type: "string" },
                  },
                  required: ["path", "content"],
                  additionalProperties: false,
                },
                description:
                  "Optional bounded text references, scripts, or assets required by the skill.",
              },
            },
            required: ["skill_markdown"],
            additionalProperties: false,
          },
        },
      },
    },
  ];
}
