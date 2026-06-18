#!/usr/bin/env node
import crypto from "node:crypto";
import process from "node:process";

const DEFAULT_STAGE = "Customer";
const DEFAULT_EVENT = "opportunity.stage.customer";
const DEFAULT_WORKFLOW_KEY = "customer_onboarding";
const THINKWORK_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER =
  "85605c4e-d3db-4415-be84-08c5210d39e2";

function parseArgs(argv) {
  const args = {
    dryRun: process.env.TWENTY_THINKWORK_WORKFLOW_WIRE_DRY_RUN !== "0",
    triggerStage: process.env.TWENTY_THINKWORK_TRIGGER_STAGE || DEFAULT_STAGE,
    event: process.env.TWENTY_THINKWORK_EVENT || DEFAULT_EVENT,
    workflowKey:
      process.env.TWENTY_THINKWORK_WORKFLOW_KEY || DEFAULT_WORKFLOW_KEY,
    createDraft: process.env.TWENTY_THINKWORK_CREATE_DRAFT_FROM_ACTIVE === "1",
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "--url") {
      args.url = requireValue(argv, ++index, arg);
    } else if (arg === "--api-key") {
      args.apiKey = requireValue(argv, ++index, arg);
    } else if (arg === "--workflow-id") {
      args.workflowId = requireValue(argv, ++index, arg);
    } else if (arg === "--workflow-version-id") {
      args.workflowVersionId = requireValue(argv, ++index, arg);
    } else if (arg === "--workflow-name") {
      args.workflowName = requireValue(argv, ++index, arg);
    } else if (arg === "--step-id") {
      args.stepId = requireValue(argv, ++index, arg);
    } else if (arg === "--trigger-stage") {
      args.triggerStage = requireValue(argv, ++index, arg);
    } else if (arg === "--event") {
      args.event = requireValue(argv, ++index, arg);
    } else if (arg === "--workflow-key") {
      args.workflowKey = requireValue(argv, ++index, arg);
    } else if (arg === "--create-draft-from-active") {
      args.createDraft = true;
    } else if (arg === "--dry-run") {
      args.dryRun = true;
    } else if (arg === "--apply") {
      args.dryRun = false;
    } else {
      throw new Error(`Unknown argument: ${arg}`);
    }
  }

  args.url ||= process.env.TWENTY_PUBLIC_URL;
  args.apiKey ||= process.env.TWENTY_APP_SYNC_API_KEY;
  return args;
}

function requireValue(argv, index, flag) {
  const value = argv[index];
  if (!value || value.startsWith("--")) {
    throw new Error(`${flag} requires a value.`);
  }
  return value;
}

function validateUrl(url) {
  if (!url) {
    throw new Error("Set TWENTY_PUBLIC_URL or pass --url.");
  }
  const parsed = new URL(url);
  if (parsed.protocol !== "https:" && parsed.hostname !== "localhost") {
    throw new Error(`Twenty URL must be HTTPS or localhost, got ${url}.`);
  }
  return parsed.toString().replace(/\/$/, "");
}

function uuid() {
  return crypto.randomUUID();
}

function compactObject(value) {
  return Object.fromEntries(
    Object.entries(value).filter(([, entry]) => entry !== undefined),
  );
}

function relationItems(value, label) {
  if (!value) return [];
  if (Array.isArray(value)) return value;
  if (Array.isArray(value.edges)) {
    return value.edges.map((edge) => edge?.node).filter(Boolean);
  }
  if (Array.isArray(value.nodes)) return value.nodes;
  if (typeof value === "object" && "id" in value) {
    return typeof value.id === "string" ? [value] : [];
  }
  throw new Error(
    `Unexpected ${label} relation shape from Twenty GraphQL: ${describeShape(value)}`,
  );
}

function describeShape(value) {
  if (value === null) return "null";
  if (Array.isArray(value)) return `array(length=${value.length})`;
  if (typeof value !== "object") return typeof value;

  const entries = Object.entries(value)
    .slice(0, 12)
    .map(([key, entry]) => {
      if (Array.isArray(entry)) return `${key}:array`;
      if (entry === null) return `${key}:null`;
      return `${key}:${typeof entry}`;
    });
  return `object{${entries.join(",")}}`;
}

class TwentyGraphqlClient {
  constructor({ url, apiKey, path = "/graphql" }) {
    this.endpoint = `${url}${path}`;
    this.apiKey = apiKey;
  }

  async request(query, variables = {}) {
    const response = await fetch(this.endpoint, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({ query, variables }),
    });
    const bodyText = await response.text();
    if (!response.ok) {
      throw new Error(`Twenty GraphQL HTTP ${response.status}: ${bodyText}`);
    }
    const body = JSON.parse(bodyText);
    if (body.errors?.length) {
      throw new Error(`Twenty GraphQL errors: ${JSON.stringify(body.errors)}`);
    }
    return body.data;
  }
}

async function findThinkWorkLogicFunction(client) {
  const data = await client.request(`
    query FindManyLogicFunctions {
      findManyLogicFunctions {
        id
        name
        workflowActionTriggerSettings
        applicationId
        universalIdentifier
      }
    }
  `);
  const matches = data.findManyLogicFunctions.filter(
    (logicFunction) =>
      logicFunction.universalIdentifier ===
        THINKWORK_WEBHOOK_LOGIC_FUNCTION_UNIVERSAL_IDENTIFIER ||
      logicFunction.name === "thinkwork-webhook",
  );
  if (matches.length === 0) {
    throw new Error(
      "ThinkWork Webhook logic function is not installed in Twenty. Sync the native ThinkWork app before wiring the workflow.",
    );
  }
  if (matches.length > 1) {
    throw new Error(
      `Expected one ThinkWork Webhook logic function, found ${matches.length}. Pass exact app evidence before wiring.`,
    );
  }
  const logicFunction = matches[0];
  if (!logicFunction.workflowActionTriggerSettings) {
    throw new Error(
      "ThinkWork Webhook logic function is installed but is not exposed as a workflow action.",
    );
  }
  return logicFunction;
}

async function findWorkflowVersion(client, args) {
  if (args.workflowVersionId) {
    const data = await client.request(
      `
        query FindOneWorkflowVersion($objectRecordId: UUID!) {
          workflowVersion(filter: { id: { eq: $objectRecordId } }) {
            id
            name
            status
            trigger
            steps
            workflow {
              id
              name
              statuses
              lastPublishedVersionId
            }
          }
        }
      `,
      { objectRecordId: args.workflowVersionId },
    );
    if (!data.workflowVersion) {
      throw new Error(
        `Workflow version ${args.workflowVersionId} was not found.`,
      );
    }
    return data.workflowVersion;
  }

  if (!args.workflowName && !args.workflowId) {
    throw new Error(
      "Pass --workflow-version-id, --workflow-id, or --workflow-name. The script will not guess which production workflow to mutate.",
    );
  }

  const workflowFilter = args.workflowId
    ? { id: { eq: args.workflowId } }
    : { name: { eq: args.workflowName } };
  const data = await client.request(
    `
      query FindWorkflowForThinkWork($filter: WorkflowFilterInput) {
        workflows(filter: $filter, first: 10) {
          edges {
            node {
              id
              name
              statuses
              lastPublishedVersionId
              versions {
                id
                name
                status
                createdAt
                trigger
                steps
              }
            }
          }
        }
      }
    `,
    { filter: workflowFilter },
  );
  const workflows = relationItems(data.workflows, "workflows");
  if (workflows.length === 0) {
    throw new Error(
      args.workflowId
        ? `Workflow ${args.workflowId} was not found.`
        : `Workflow named "${args.workflowName}" was not found.`,
    );
  }
  if (workflows.length > 1) {
    throw new Error(
      `Expected one workflow, found ${workflows.length}. Pass --workflow-id or --workflow-version-id.`,
    );
  }
  const workflow = workflows[0];
  const nestedVersions = relationItems(
    workflow.versions,
    "workflow versions",
  ).filter((version) => version.id);
  const versions = (
    nestedVersions.length > 0
      ? nestedVersions
      : await findWorkflowVersionsForWorkflow(client, workflow.id)
  ).sort((left, right) => (left.createdAt > right.createdAt ? -1 : 1));
  const draft = versions.find((version) => version.status === "DRAFT");
  const active =
    versions.find(
      (version) => version.id === workflow.lastPublishedVersionId,
    ) ?? versions.find((version) => version.status === "ACTIVE");
  const selected = draft ?? active ?? versions[0];
  if (!selected) {
    throw new Error(`Workflow "${workflow.name}" has no versions.`);
  }
  return {
    ...selected,
    workflow: {
      id: workflow.id,
      name: workflow.name,
      statuses: workflow.statuses,
      lastPublishedVersionId: workflow.lastPublishedVersionId,
    },
  };
}

async function findWorkflowVersionsForWorkflow(client, workflowId) {
  const attempts = [
    {
      description: "workflowId filter",
      query: `
        query FindWorkflowVersionsByWorkflowId($workflowId: UUID!) {
          workflowVersions(filter: { workflowId: { eq: $workflowId } }, first: 50) {
            edges {
              node {
                id
                name
                status
                createdAt
                trigger
                steps
                workflow {
                  id
                  name
                  statuses
                  lastPublishedVersionId
                }
              }
            }
          }
        }
      `,
      variables: { workflowId },
    },
    {
      description: "workflow relation filter",
      query: `
        query FindWorkflowVersionsByWorkflowRelation($workflowId: UUID!) {
          workflowVersions(filter: { workflow: { id: { eq: $workflowId } } }, first: 50) {
            edges {
              node {
                id
                name
                status
                createdAt
                trigger
                steps
                workflow {
                  id
                  name
                  statuses
                  lastPublishedVersionId
                }
              }
            }
          }
        }
      `,
      variables: { workflowId },
    },
    {
      description: "client-side workflow filter",
      query: `
        query FindWorkflowVersionsForClientFilter {
          workflowVersions(first: 100) {
            edges {
              node {
                id
                name
                status
                createdAt
                trigger
                steps
                workflowId
                workflow {
                  id
                  name
                  statuses
                  lastPublishedVersionId
                }
              }
            }
          }
        }
      `,
      variables: {},
      filter: (version) =>
        version.workflowId === workflowId ||
        version.workflow?.id === workflowId,
    },
  ];
  const errors = [];
  for (const attempt of attempts) {
    try {
      const data = await client.request(attempt.query, attempt.variables);
      const versions = relationItems(
        data.workflowVersions,
        "workflowVersions",
      ).filter((version) => !attempt.filter || attempt.filter(version));
      if (versions.length > 0) return versions;
      errors.push(`${attempt.description}: no versions returned`);
    } catch (error) {
      errors.push(
        `${attempt.description}: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  }
  throw new Error(
    `Could not load workflow versions for workflow ${workflowId}. Attempts: ${errors.join(" | ")}`,
  );
}

async function createDraftFromActive(client, workflowVersion) {
  const workflowId = workflowVersion.workflow?.id;
  if (!workflowId) {
    throw new Error(
      "Cannot create a draft because the selected workflow version did not include workflow.id.",
    );
  }
  const data = await client.request(
    `
      mutation CreateDraftFromWorkflowVersion(
        $input: CreateDraftFromWorkflowVersionInput!
      ) {
        createDraftFromWorkflowVersion(input: $input) {
          id
          name
          status
          trigger
          steps
          createdAt
          updatedAt
        }
      }
    `,
    {
      input: {
        workflowId,
        workflowVersionIdToCopy: workflowVersion.id,
      },
    },
  );
  return {
    ...data.createDraftFromWorkflowVersion,
    workflow: workflowVersion.workflow,
  };
}

function selectStep(workflowVersion, stepId) {
  const steps = workflowVersion.steps ?? [];
  if (stepId) {
    const step = steps.find((candidate) => candidate.id === stepId);
    if (!step) {
      throw new Error(
        `Step ${stepId} was not found in workflow version ${workflowVersion.id}.`,
      );
    }
    return step;
  }
  const httpSteps = steps.filter((step) => step.type === "HTTP_REQUEST");
  if (httpSteps.length === 0) {
    const existing = steps.find((step) => step.type === "LOGIC_FUNCTION");
    if (existing) return existing;
    throw new Error(
      "No HTTP_REQUEST step was found to replace. Pass --step-id for the exact workflow action.",
    );
  }
  if (httpSteps.length > 1) {
    throw new Error(
      `Found ${httpSteps.length} HTTP_REQUEST steps. Pass --step-id so the script does not replace the wrong action.`,
    );
  }
  return httpSteps[0];
}

function buildThinkWorkStep({ existingStep, logicFunction, args }) {
  return compactObject({
    id: existingStep.id || uuid(),
    name: "ThinkWork Webhook",
    type: "LOGIC_FUNCTION",
    valid: true,
    nextStepIds: existingStep.nextStepIds,
    position: existingStep.position,
    settings: {
      input: {
        logicFunctionId: logicFunction.id,
        logicFunctionInput: {
          event: args.event,
          opportunityId: "{{trigger.object.id}}",
          opportunityName: "{{trigger.object.name}}",
          companyName: "{{trigger.object.company.name}}",
          stage: "{{trigger.object.stage}}",
          workflowKey: args.workflowKey,
          occurredAt: "{{trigger.object.updatedAt}}",
          idempotencyKey: `twenty-app:${args.workflowKey}:{{trigger.object.id}}:${args.triggerStage}`,
        },
      },
    },
  });
}

function summarize({
  args,
  logicFunction,
  workflowVersion,
  existingStep,
  step,
}) {
  return {
    mode: args.dryRun ? "dry-run" : "apply",
    workflow: workflowVersion.workflow
      ? {
          id: workflowVersion.workflow.id,
          name: workflowVersion.workflow.name,
          statuses: workflowVersion.workflow.statuses,
        }
      : undefined,
    workflowVersion: {
      id: workflowVersion.id,
      name: workflowVersion.name,
      status: workflowVersion.status,
    },
    existingStep: {
      id: existingStep.id,
      name: existingStep.name,
      type: existingStep.type,
    },
    replacementStep: {
      id: step.id,
      name: step.name,
      type: step.type,
      logicFunctionId: logicFunction.id,
      logicFunctionUniversalIdentifier: logicFunction.universalIdentifier,
      triggerStage: args.triggerStage,
      workflowKey: args.workflowKey,
    },
  };
}

async function updateWorkflowVersionStep(client, workflowVersionId, step) {
  const data = await client.request(
    `
      mutation UpdateWorkflowVersionStep($input: UpdateWorkflowVersionStepInput!) {
        updateWorkflowVersionStep(input: $input) {
          id
          name
          type
          settings
          valid
          nextStepIds
          position {
            x
            y
          }
        }
      }
    `,
    {
      input: {
        workflowVersionId,
        step,
      },
    },
  );
  return data.updateWorkflowVersionStep;
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const url = validateUrl(args.url);
  if (!args.apiKey) {
    throw new Error("Set TWENTY_APP_SYNC_API_KEY or pass --api-key.");
  }

  const dataClient = new TwentyGraphqlClient({
    url,
    apiKey: args.apiKey,
    path: "/graphql",
  });
  const metadataClient = new TwentyGraphqlClient({
    url,
    apiKey: args.apiKey,
    path: "/metadata",
  });
  const logicFunction = await findThinkWorkLogicFunction(metadataClient);
  let workflowVersion = await findWorkflowVersion(dataClient, args);

  if (!args.dryRun && workflowVersion.status !== "DRAFT" && args.createDraft) {
    workflowVersion = await createDraftFromActive(dataClient, workflowVersion);
  }

  if (!args.dryRun && workflowVersion.status !== "DRAFT") {
    throw new Error(
      `Workflow version ${workflowVersion.id} is ${workflowVersion.status}; create or target a DRAFT version before applying workflow wiring.`,
    );
  }

  const existingStep = selectStep(workflowVersion, args.stepId);
  const step = buildThinkWorkStep({ existingStep, logicFunction, args });
  const report = summarize({
    args,
    logicFunction,
    workflowVersion,
    existingStep,
    step,
  });

  if (args.dryRun) {
    console.log(JSON.stringify(report, null, 2));
    return;
  }

  const updatedStep = await updateWorkflowVersionStep(
    dataClient,
    workflowVersion.id,
    step,
  );
  console.log(JSON.stringify({ ...report, updatedStep }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
}
