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
      createdAt
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
