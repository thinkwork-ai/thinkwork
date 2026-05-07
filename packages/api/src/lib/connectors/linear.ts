export interface LinearApiIssue {
  id: string;
  identifier: string;
  title: string;
  description?: string | null;
  url?: string | null;
  state?: string | null;
  labels: string[];
  priority?: number | null;
  createdAt?: string | null;
  updatedAt?: string | null;
}

export interface LinearIssueQueryConfig {
  credentialId?: string;
  credentialSlug?: string;
  teamId?: string;
  teamKey?: string;
  labels: string[];
  states: string[];
  limit: number;
}

export interface LinearFetchOptions {
  apiKey: string;
  query: LinearIssueQueryConfig;
  fetchImpl?: typeof fetch;
}

export interface LinearMoveIssueStateOptions {
  apiKey: string;
  issueId: string;
  stateName: string;
  fetchImpl?: typeof fetch;
}

export interface LinearMoveIssueStateResult {
  issueId: string;
  stateName: string;
  stateId?: string;
  updated: boolean;
  skippedReason?: string;
}

type LinearGraphqlResponse = {
  data?: {
    issues?: {
      nodes?: unknown[];
    } | null;
  } | null;
  errors?: Array<{ message?: string }>;
};

type LinearIssueStateResponse = {
  data?: {
    issue?: unknown;
  } | null;
  errors?: Array<{ message?: string }>;
};

type LinearIssueUpdateResponse = {
  data?: {
    issueUpdate?: {
      success?: boolean;
      issue?: unknown;
    } | null;
  } | null;
  errors?: Array<{ message?: string }>;
};

const LINEAR_GRAPHQL_URL = "https://api.linear.app/graphql";
const DEFAULT_LIMIT = 25;
const MAX_LIMIT = 50;

export function parseLinearIssueQueryConfig(
  config: unknown,
): LinearIssueQueryConfig | null {
  const root = asRecord(config);
  if (!root) return null;

  const issueQuery = asRecord(root.issueQuery) ?? {};
  const credentialId = cleanString(
    root.credentialId ?? issueQuery.credentialId,
  );
  const credentialSlug = cleanString(
    root.credentialSlug ?? issueQuery.credentialSlug,
  );
  if (!credentialId && !credentialSlug) return null;

  return {
    credentialId: credentialId ?? undefined,
    credentialSlug: credentialSlug ?? undefined,
    teamId: cleanString(root.teamId ?? issueQuery.teamId) ?? undefined,
    teamKey: cleanString(root.teamKey ?? issueQuery.teamKey) ?? undefined,
    labels: cleanStringArray(
      issueQuery.labels ?? root.labels ?? root.gatingLabels,
    ).concat(
      cleanStringArray(issueQuery.label ?? root.label ?? root.gatingLabel),
    ),
    states: cleanStringArray(issueQuery.states ?? root.states),
    limit: clampLimit(issueQuery.limit ?? root.limit),
  };
}

export async function fetchLinearIssues(
  options: LinearFetchOptions,
): Promise<LinearApiIssue[]> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: options.apiKey,
    },
    body: JSON.stringify({
      query: LINEAR_ISSUES_QUERY,
      variables: {
        first: options.query.limit,
        filter: linearIssueFilter(options.query),
      },
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Linear API request failed with HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  const payload = (await response.json()) as LinearGraphqlResponse;
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `Linear API error: ${payload.errors
        .map((error) => error.message ?? "Unknown error")
        .join("; ")}`,
    );
  }

  const nodes = payload.data?.issues?.nodes ?? [];
  return nodes.flatMap((node) => {
    const issue = linearNodeToIssue(node);
    return issue ? [issue] : [];
  });
}

export async function moveLinearIssueToState(
  options: LinearMoveIssueStateOptions,
): Promise<LinearMoveIssueStateResult> {
  const fetchImpl = options.fetchImpl ?? fetch;
  const issuePayload = await linearGraphql<LinearIssueStateResponse>(
    fetchImpl,
    {
      apiKey: options.apiKey,
      query: LINEAR_ISSUE_STATE_QUERY,
      variables: { id: options.issueId },
    },
  );

  const issue = asRecord(issuePayload.data?.issue);
  if (!issue) {
    throw new Error(`Linear issue ${options.issueId} not found`);
  }

  const currentState = asRecord(issue.state);
  const currentStateName = cleanString(currentState?.name);
  if (currentStateName?.toLowerCase() === options.stateName.toLowerCase()) {
    return {
      issueId: options.issueId,
      stateName: options.stateName,
      stateId: cleanString(currentState?.id) ?? undefined,
      updated: false,
      skippedReason: "already_in_state",
    };
  }

  const team = asRecord(issue.team);
  const statesConnection = asRecord(team?.states);
  const stateNodes = Array.isArray(statesConnection?.nodes)
    ? statesConnection.nodes
    : [];
  const targetState = stateNodes
    .map(asRecord)
    .find(
      (state) =>
        cleanString(state?.name)?.toLowerCase() ===
        options.stateName.toLowerCase(),
    );
  const stateId = cleanString(targetState?.id);
  if (!stateId) {
    throw new Error(
      `Linear state ${options.stateName} not found for issue ${options.issueId}`,
    );
  }

  const updatePayload = await linearGraphql<LinearIssueUpdateResponse>(
    fetchImpl,
    {
      apiKey: options.apiKey,
      query: LINEAR_ISSUE_UPDATE_STATE_MUTATION,
      variables: {
        id: options.issueId,
        input: { stateId },
      },
    },
  );
  if (updatePayload.data?.issueUpdate?.success !== true) {
    throw new Error(`Linear issue ${options.issueId} state update failed`);
  }

  return {
    issueId: options.issueId,
    stateName: options.stateName,
    stateId,
    updated: true,
  };
}

async function linearGraphql<
  TPayload extends { errors?: Array<{ message?: string }> },
>(
  fetchImpl: typeof fetch,
  args: {
    apiKey: string;
    query: string;
    variables: Record<string, unknown>;
  },
): Promise<TPayload> {
  const response = await fetchImpl(LINEAR_GRAPHQL_URL, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      authorization: args.apiKey,
    },
    body: JSON.stringify({
      query: args.query,
      variables: args.variables,
    }),
  });

  if (!response.ok) {
    throw new Error(
      `Linear API request failed with HTTP ${response.status} ${response.statusText}`.trim(),
    );
  }

  const payload = (await response.json()) as TPayload;
  if (payload.errors && payload.errors.length > 0) {
    throw new Error(
      `Linear API error: ${payload.errors
        .map((error) => error.message ?? "Unknown error")
        .join("; ")}`,
    );
  }
  return payload;
}

function linearIssueFilter(
  query: LinearIssueQueryConfig,
): Record<string, unknown> {
  const filter: Record<string, unknown> = {};
  const teamFilter: Record<string, unknown> = {};
  if (query.teamId) teamFilter.id = { eq: query.teamId };
  if (query.teamKey) teamFilter.key = { eqIgnoreCase: query.teamKey };
  if (Object.keys(teamFilter).length > 0) filter.team = teamFilter;

  if (query.labels.length === 1) {
    filter.labels = { name: { eqIgnoreCase: query.labels[0] } };
  } else if (query.labels.length > 1) {
    filter.labels = { name: { in: query.labels } };
  }

  if (query.states.length === 1) {
    filter.state = { name: { eqIgnoreCase: query.states[0] } };
  } else if (query.states.length > 1) {
    filter.state = { name: { in: query.states } };
  }

  return filter;
}

function linearNodeToIssue(node: unknown): LinearApiIssue | null {
  const record = asRecord(node);
  if (!record) return null;
  const id = cleanString(record.id);
  const identifier = cleanString(record.identifier);
  const title = cleanString(record.title);
  if (!id || !identifier || !title) return null;

  const labelsConnection = asRecord(record.labels);
  const labelNodes = Array.isArray(labelsConnection?.nodes)
    ? labelsConnection.nodes
    : [];
  const labels = labelNodes.flatMap((label) => {
    const name = cleanString(asRecord(label)?.name);
    return name ? [name] : [];
  });

  return {
    id,
    identifier,
    title,
    description: cleanString(record.description),
    url: cleanString(record.url),
    state: cleanString(asRecord(record.state)?.name),
    labels,
    priority: typeof record.priority === "number" ? record.priority : null,
    createdAt: cleanString(record.createdAt),
    updatedAt: cleanString(record.updatedAt),
  };
}

function cleanStringArray(value: unknown): string[] {
  if (Array.isArray(value)) {
    return value.flatMap((item) => {
      const cleaned = cleanString(item);
      return cleaned ? [cleaned] : [];
    });
  }
  const cleaned = cleanString(value);
  return cleaned ? [cleaned] : [];
}

function clampLimit(value: unknown): number {
  const numeric = typeof value === "number" ? value : Number(value);
  if (!Number.isFinite(numeric) || numeric <= 0) return DEFAULT_LIMIT;
  return Math.min(Math.floor(numeric), MAX_LIMIT);
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

function cleanString(value: unknown): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed.length > 0 ? trimmed : null;
}

const LINEAR_ISSUES_QUERY = /* GraphQL */ `
  query ConnectorLinearIssues($first: Int!, $filter: IssueFilter) {
    issues(first: $first, filter: $filter) {
      nodes {
        id
        identifier
        title
        description
        url
        priority
        createdAt
        updatedAt
        state {
          name
        }
        labels {
          nodes {
            name
          }
        }
      }
    }
  }
`;

const LINEAR_ISSUE_STATE_QUERY = /* GraphQL */ `
  query ConnectorLinearIssueState($id: String!) {
    issue(id: $id) {
      id
      state {
        id
        name
      }
      team {
        states(first: 100) {
          nodes {
            id
            name
          }
        }
      }
    }
  }
`;

const LINEAR_ISSUE_UPDATE_STATE_MUTATION = /* GraphQL */ `
  mutation ConnectorLinearIssueUpdateState(
    $id: String!
    $input: IssueUpdateInput!
  ) {
    issueUpdate(id: $id, input: $input) {
      success
      issue {
        id
        state {
          id
          name
        }
      }
    }
  }
`;
