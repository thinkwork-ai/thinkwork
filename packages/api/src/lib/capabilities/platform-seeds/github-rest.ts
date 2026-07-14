/**
 * GitHub REST reference operation contracts (THINK-280 U5 — tracer).
 *
 * REFERENCE DATA ONLY. This module holds the exact operation contracts for the
 * GitHub issue-health digest tracer: repository metadata, issue listing, and
 * issue detail. It is consumed as the descriptor fed to `admitConnectionProposal`
 * during dogfood admission (U2) and by tests — it is NOT an alternate admission
 * path and performs no admission itself.
 *
 * Every operation is:
 *   - `read` effect, `reversible`, `idempotent`;
 *   - CLOSED `targetScope` to ONE configured repository (owner/repo are baked
 *     into the resource selector; only bounded pagination / an integer issue
 *     number vary per call);
 *   - service-principal capable;
 *   - bounded output (projected safe fields, capped page size / array length);
 *   - `low` cost, `interactive` latency, `inline` output.
 *
 * The `targetScope.resourceSelector` encodes the HTTP binding the broker's
 * `http_openapi` adapter reads (method, host, path template, fixed/allowed
 * query, credential placement, response cap). Host/path/method are contract-
 * fixed, so no authored input can steer the adapter to a different resource.
 */

import type {
  CanonicalJson,
  CapabilityDescriptor,
  OperationContract,
} from "@thinkwork/capability-contracts";

const GITHUB_HOST = "api.github.com";

/** Credential placement shared by every GitHub REST operation. */
const GITHUB_CREDENTIAL = {
  name: "github",
  field: "token",
  placement: "header",
  param: "Authorization",
  scheme: "Bearer",
} as const;

/** Safe repository fields returned by `repos.get`. */
const REPO_OUTPUT_SCHEMA: CanonicalJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    id: { type: "integer" },
    full_name: { type: "string", maxLength: 512 },
    description: { type: "string", maxLength: 4096 },
    open_issues_count: { type: "integer" },
    default_branch: { type: "string", maxLength: 256 },
    html_url: { type: "string", maxLength: 2048 },
    updated_at: { type: "string", maxLength: 64 },
  },
};

/** Safe per-issue fields returned by the listing and detail operations. */
const ISSUE_OUTPUT_SCHEMA: CanonicalJson = {
  type: "object",
  additionalProperties: false,
  properties: {
    number: { type: "integer" },
    title: { type: "string", maxLength: 1024 },
    state: { type: "string", maxLength: 32 },
    html_url: { type: "string", maxLength: 2048 },
    created_at: { type: "string", maxLength: 64 },
    updated_at: { type: "string", maxLength: 64 },
    comments: { type: "integer" },
    user: {
      type: "object",
      additionalProperties: false,
      properties: { login: { type: "string", maxLength: 256 } },
    },
    // Public, bounded projections the issue-health digest groups by (THINK-280
    // U7). Labels + assignees are public metadata; capped array lengths keep
    // the response bounded.
    labels: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { name: { type: "string", maxLength: 256 } },
      },
    },
    assignees: {
      type: "array",
      maxItems: 50,
      items: {
        type: "object",
        additionalProperties: false,
        properties: { login: { type: "string", maxLength: 256 } },
      },
    },
  },
};

export interface GithubRestConfig {
  /** Tenant slug — the descriptor namespace (SEGMENT_RE). */
  namespace: string;
  /** Configured repository owner (baked into every path). */
  owner: string;
  /** Configured repository name (baked into every path). */
  repo: string;
}

function repoBasePath(cfg: GithubRestConfig): string {
  return `/repos/${encodeURIComponent(cfg.owner)}/${encodeURIComponent(cfg.repo)}`;
}

/** `repos.get` — repository metadata for the configured repo. */
export function githubRepoGetContract(
  cfg: GithubRestConfig,
): OperationContract {
  return {
    operationId: "repos.get",
    summary: "Get metadata for the configured GitHub repository",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: {
        method: "GET",
        host: GITHUB_HOST,
        path: repoBasePath(cfg),
        credential: { ...GITHUB_CREDENTIAL },
        maxResponseBytes: 16 * 1024,
        onExceed: "fail",
      },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {},
    },
    outputSchema: REPO_OUTPUT_SCHEMA,
    inputDataClass: "internal",
    outputDataClass: "public",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
  };
}

/** `issues.list` — bounded page of issues for the configured repo. */
export function githubIssuesListContract(
  cfg: GithubRestConfig,
): OperationContract {
  return {
    operationId: "issues.list",
    summary: "List issues for the configured GitHub repository (bounded page)",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: {
        method: "GET",
        host: GITHUB_HOST,
        path: `${repoBasePath(cfg)}/issues`,
        fixedQuery: { per_page: "50" },
        allowedQuery: ["state", "page"],
        credential: { ...GITHUB_CREDENTIAL },
        maxResponseBytes: 64 * 1024,
        onExceed: "durable",
      },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      properties: {
        state: { type: "string", enum: ["open", "closed", "all"] },
        page: { type: "integer", minimum: 1, maximum: 20 },
      },
    },
    outputSchema: { type: "array", maxItems: 50, items: ISSUE_OUTPUT_SCHEMA },
    inputDataClass: "internal",
    outputDataClass: "public",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
  };
}

/** `issues.get` — one issue's detail by integer number in the configured repo. */
export function githubIssueGetContract(
  cfg: GithubRestConfig,
): OperationContract {
  return {
    operationId: "issues.get",
    summary: "Get one issue's detail from the configured GitHub repository",
    effect: "read",
    targetScope: {
      kind: "closed",
      resourceSelector: {
        method: "GET",
        host: GITHUB_HOST,
        path: `${repoBasePath(cfg)}/issues/{issueNumber}`,
        pathParams: { issueNumber: "issueNumber" },
        credential: { ...GITHUB_CREDENTIAL },
        maxResponseBytes: 32 * 1024,
        onExceed: "fail",
      },
    },
    reversibility: "reversible",
    idempotency: "idempotent",
    principalModes: ["service"],
    approvalPolicy: "never",
    inputSchema: {
      type: "object",
      additionalProperties: false,
      required: ["issueNumber"],
      properties: { issueNumber: { type: "integer", minimum: 1 } },
    },
    outputSchema: ISSUE_OUTPUT_SCHEMA,
    inputDataClass: "internal",
    outputDataClass: "public",
    costClass: "low",
    latencyClass: "interactive",
    outputClass: "inline",
  };
}

/** Ordered operation ids exposed by the tracer's GitHub REST reference. */
export const GITHUB_REST_OPERATION_IDS = [
  "repos.get",
  "issues.list",
  "issues.get",
] as const;

/** All three reference operation contracts for the configured repo. */
export function githubRestOperations(
  cfg: GithubRestConfig,
): OperationContract[] {
  return [
    githubRepoGetContract(cfg),
    githubIssuesListContract(cfg),
    githubIssueGetContract(cfg),
  ];
}

/**
 * The full reference descriptor fed to `admitConnectionProposal` during
 * dogfood admission. Closed-scoped to the configured repository.
 */
export function githubRestReferenceDescriptor(
  cfg: GithubRestConfig,
): CapabilityDescriptor {
  return {
    namespace: cfg.namespace,
    class: "connection",
    slug: "github-rest",
    version: "1",
    adapter: {
      kind: "http_openapi",
      config: { baseUrl: `https://${GITHUB_HOST}` },
    },
    bindingRequirements: {
      credentialKinds: ["bearer_token"],
      principalModes: ["service"],
    },
    provenance: {
      sourceUrls: [
        "https://docs.github.com/en/rest/repos/repos#get-a-repository",
        "https://docs.github.com/en/rest/issues/issues#list-repository-issues",
        "https://docs.github.com/en/rest/issues/issues#get-an-issue",
      ],
      evidenceRefs: [],
    },
    operations: githubRestOperations(cfg),
  };
}
