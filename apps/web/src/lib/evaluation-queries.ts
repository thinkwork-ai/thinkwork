import { graphql } from "@/gql";

// Typed graphql() operations for the Evaluations settings surface. Ported from
// apps/web's untyped `graphql-queries.ts` eval blocks into a codegen-included
// file (spaces excludes `graphql-queries.ts` from codegen), exactly like
// `routine-queries.ts`. Backing store is AWS Bedrock AgentCore Evaluations.

export const EvalSummaryQuery = graphql(`
  query EvalSummary($tenantId: ID!) {
    evalSummary(tenantId: $tenantId) {
      totalRuns
      latestPassRate
      avgPassRate
      regressionCount
    }
  }
`);

export const EvalRunsQuery = graphql(`
  query EvalRuns($tenantId: ID!, $limit: Int, $offset: Int) {
    evalRuns(tenantId: $tenantId, limit: $limit, offset: $offset) {
      items {
        id
        status
        model
        categories
        totalTests
        passed
        failed
        errored
        scoringVersion
        isLegacyScoring
        datasetId
        datasetVersion
        passRate
        regression
        costUsd
        agentId
        agentName
        scheduledJobId
        executionTarget
        runtimeHost
        startedAt
        completedAt
        createdAt
      }
      totalCount
    }
  }
`);

export const EvalRunQuery = graphql(`
  query EvalRun($id: ID!) {
    evalRun(id: $id) {
      id
      status
      model
      categories
      totalTests
      passed
      failed
      errored
      scoringVersion
      isLegacyScoring
      datasetId
      datasetVersion
      passRate
      regression
      costUsd
      errorMessage
      agentId
      agentName
      scheduledJobId
      executionTarget
      runtimeHost
      startedAt
      completedAt
      createdAt
    }
  }
`);

export const EvalRunResultsQuery = graphql(`
  query EvalRunResults($runId: ID!) {
    evalRunResults(runId: $runId) {
      id
      testCaseId
      testCaseName
      category
      status
      score
      durationMs
      agentSessionId
      input
      actualOutput
      systemPrompt
      evaluatorResults
      assertions
      errorMessage
      errorCause
      overrideStatus
      overriddenBy
      overriddenAt
      overrideReason
      effectiveStatus
      createdAt
    }
  }
`);

// Operator verdict override (Trust Core U9). The override never mutates
// the judge's verdict — it's a separate field aggregation reads last.
// overriddenBy is derived server-side from the authenticated caller.
export const OverrideEvalResultMutation = graphql(`
  mutation OverrideEvalResult($input: OverrideEvalResultInput!) {
    overrideEvalResult(input: $input) {
      id
      status
      overrideStatus
      overriddenBy
      overriddenAt
      overrideReason
      effectiveStatus
    }
  }
`);

export const EvalResultSpansQuery = graphql(`
  query EvalResultSpans($runId: ID!, $testCaseId: ID!) {
    evalResultSpans(runId: $runId, testCaseId: $testCaseId) {
      timestamp
      name
      attributes
    }
  }
`);

export const EvalTimeSeriesQuery = graphql(`
  query EvalTimeSeries($tenantId: ID!, $days: Int) {
    evalTimeSeries(tenantId: $tenantId, days: $days) {
      day
      passRate
      runCount
      passed
      failed
    }
  }
`);

export const EvalTestCasesQuery = graphql(`
  query EvalTestCases($tenantId: ID!, $category: String, $search: String) {
    evalTestCases(tenantId: $tenantId, category: $category, search: $search) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      tags
      enabled
      source
      createdAt
      updatedAt
    }
  }
`);

export const EvalTestCaseQuery = graphql(`
  query EvalTestCase($id: ID!) {
    evalTestCase(id: $id) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      tags
      enabled
      source
      createdAt
      updatedAt
    }
  }
`);

export const EvalTestCaseHistoryQuery = graphql(`
  query EvalTestCaseHistory($testCaseId: ID!, $limit: Int) {
    evalTestCaseHistory(testCaseId: $testCaseId, limit: $limit) {
      id
      runId
      testCaseName
      category
      status
      score
      durationMs
      input
      expected
      actualOutput
      assertions
      evaluatorResults
      errorMessage
      createdAt
    }
  }
`);

export const StartEvalRunMutation = graphql(`
  mutation StartEvalRun($tenantId: ID!, $input: StartEvalRunInput!) {
    startEvalRun(tenantId: $tenantId, input: $input) {
      id
      status
      categories
      createdAt
    }
  }
`);

export const CreateEvalTestCaseMutation = graphql(`
  mutation CreateEvalTestCase(
    $tenantId: ID!
    $input: CreateEvalTestCaseInput!
  ) {
    createEvalTestCase(tenantId: $tenantId, input: $input) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      enabled
      createdAt
    }
  }
`);

export const UpdateEvalTestCaseMutation = graphql(`
  mutation UpdateEvalTestCase($id: ID!, $input: UpdateEvalTestCaseInput!) {
    updateEvalTestCase(id: $id, input: $input) {
      id
      name
      category
      query
      systemPrompt
      assertions
      agentcoreEvaluatorIds
      enabled
      updatedAt
    }
  }
`);

export const SeedEvalTestCasesMutation = graphql(`
  mutation SeedEvalTestCases($tenantId: ID!, $categories: [String!]) {
    seedEvalTestCases(tenantId: $tenantId, categories: $categories)
  }
`);

export const DeleteEvalTestCaseMutation = graphql(`
  mutation DeleteEvalTestCase($id: ID!) {
    deleteEvalTestCase(id: $id)
  }
`);

export const DeleteEvalRunMutation = graphql(`
  mutation DeleteEvalRun($id: ID!) {
    deleteEvalRun(id: $id)
  }
`);

export const CancelEvalRunMutation = graphql(`
  mutation CancelEvalRun($id: ID!) {
    cancelEvalRun(id: $id) {
      id
      status
      completedAt
    }
  }
`);

export const OnEvalRunUpdatedSubscription = graphql(`
  subscription OnEvalRunUpdated($tenantId: ID!) {
    onEvalRunUpdated(tenantId: $tenantId) {
      runId
      tenantId
      agentId
      status
      totalTests
      passed
      failed
      passRate
      errorMessage
      updatedAt
    }
  }
`);

// ────────────────────────────────────────────────────────────────────
// Flag-thread → dataset case (Trust Core U7)
// ────────────────────────────────────────────────────────────────────

export const EvalDatasetsForFlagQuery = graphql(`
  query EvalDatasetsForFlag($tenantId: ID!) {
    evalDatasets(tenantId: $tenantId) {
      id
      slug
      name
      kind
      archivedAt
    }
  }
`);

// ────────────────────────────────────────────────────────────────────
// Datasets UI (Trust Core U11) — list/detail + CRUD over the U4
// substrate. S3 is canonical; these read the derived index.
// ────────────────────────────────────────────────────────────────────

export const EvalDatasetsQuery = graphql(`
  query EvalDatasets($tenantId: ID!, $includeArchived: Boolean) {
    evalDatasets(tenantId: $tenantId, includeArchived: $includeArchived) {
      id
      slug
      name
      kind
      version
      archivedAt
      createdAt
      updatedAt
    }
  }
`);

export const EvalDatasetQuery = graphql(`
  query EvalDataset($tenantId: ID!, $slug: String!) {
    evalDataset(tenantId: $tenantId, slug: $slug) {
      id
      slug
      name
      kind
      version
      archivedAt
      createdAt
      updatedAt
    }
  }
`);

// Lightweight index read used to count cases per dataset on the list
// page (one query, grouped client-side — no N+1).
export const EvalDatasetCaseIndexQuery = graphql(`
  query EvalDatasetCaseIndex($tenantId: ID!) {
    evalTestCases(tenantId: $tenantId) {
      id
      datasetId
      enabled
    }
  }
`);

export const EvalDatasetCasesQuery = graphql(`
  query EvalDatasetCases($tenantId: ID!, $datasetId: ID) {
    evalTestCases(tenantId: $tenantId, datasetId: $datasetId) {
      id
      name
      category
      tags
      enabled
      source
      datasetId
      datasetCaseId
      createdAt
      updatedAt
    }
  }
`);

export const CreateEvalDatasetMutation = graphql(`
  mutation CreateEvalDataset($tenantId: ID!, $input: CreateEvalDatasetInput!) {
    createEvalDataset(tenantId: $tenantId, input: $input) {
      id
      slug
      name
      kind
      version
      archivedAt
    }
  }
`);

export const UpdateEvalDatasetMutation = graphql(`
  mutation UpdateEvalDataset(
    $tenantId: ID!
    $slug: String!
    $input: UpdateEvalDatasetInput!
  ) {
    updateEvalDataset(tenantId: $tenantId, slug: $slug, input: $input) {
      id
      slug
      name
      kind
      version
      archivedAt
    }
  }
`);

export const ArchiveEvalDatasetMutation = graphql(`
  mutation ArchiveEvalDataset($tenantId: ID!, $slug: String!) {
    archiveEvalDataset(tenantId: $tenantId, slug: $slug) {
      id
      slug
      archivedAt
    }
  }
`);

export const UpdateEvalDatasetCaseMutation = graphql(`
  mutation UpdateEvalDatasetCase(
    $tenantId: ID!
    $datasetSlug: String!
    $caseId: String!
    $input: UpdateEvalDatasetCaseInput!
  ) {
    updateEvalDatasetCase(
      tenantId: $tenantId
      datasetSlug: $datasetSlug
      caseId: $caseId
      input: $input
    ) {
      id
      datasetCaseId
      enabled
      updatedAt
    }
  }
`);

export const RemoveEvalDatasetCaseMutation = graphql(`
  mutation RemoveEvalDatasetCase(
    $tenantId: ID!
    $datasetSlug: String!
    $caseId: String!
  ) {
    removeEvalDatasetCase(
      tenantId: $tenantId
      datasetSlug: $datasetSlug
      caseId: $caseId
    ) {
      id
      slug
      version
    }
  }
`);

// Read-only MCP replay allowlist (Trust Core U13). Default-deny: replay
// carries an MCP tool only if an operator lists it here.
export const EvalReplayToolAllowlistQuery = graphql(`
  query EvalReplayToolAllowlist($tenantId: ID!) {
    evalReplayToolAllowlist(tenantId: $tenantId) {
      id
      tenantId
      serverName
      toolName
      createdAt
    }
  }
`);

export const EvalReplayAvailableMcpToolsQuery = graphql(`
  query EvalReplayAvailableMcpTools($tenantId: ID!) {
    evalReplayAvailableMcpTools(tenantId: $tenantId) {
      serverName
      displayName
      tools {
        name
        description
      }
    }
  }
`);

export const AddEvalReplayAllowedToolMutation = graphql(`
  mutation AddEvalReplayAllowedTool(
    $tenantId: ID!
    $serverName: String!
    $toolName: String!
  ) {
    addEvalReplayAllowedTool(
      tenantId: $tenantId
      serverName: $serverName
      toolName: $toolName
    ) {
      id
      tenantId
      serverName
      toolName
      createdAt
    }
  }
`);

export const RemoveEvalReplayAllowedToolMutation = graphql(`
  mutation RemoveEvalReplayAllowedTool($id: ID!) {
    removeEvalReplayAllowedTool(id: $id)
  }
`);

export const FlagThreadForEvalMutation = graphql(`
  mutation FlagThreadForEval($input: FlagThreadForEvalInput!) {
    flagThreadForEval(input: $input) {
      case {
        id
        datasetId
        datasetCaseId
        name
        category
        tags
      }
      dataset {
        id
        slug
        name
      }
      completeness {
        history
        workspace
        traces
        truncated
      }
    }
  }
`);
